"""Public endpoints: signup, email verification, forgot/reset password."""

import logging
from pathlib import Path
from typing import Annotated

from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import PlainTextResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import User
from app.models.tenant import EmailVerificationToken, PasswordResetToken, AccountClosureToken
from app.models.user import utcnow_naive
from app.schemas.tenant import (
    SignupRequest, SignupResponse,
    VerifyEmailRequest, ForgotPasswordRequest, ResetPasswordRequest,
    ResendVerificationRequest, PlanResponse,
)
from app.models.tenant import Plan
from app.models.platform_settings import PlatformSettings
from app.services.tenant_service import TenantService
from app.services import email_service
from app.config import get_settings
from app.core.security import get_password_hash

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/signup", response_model=SignupResponse)
async def signup(data: SignupRequest, db: Annotated[AsyncSession, Depends(get_db)]):
    if not data.accept_terms:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You must accept the terms and conditions",
        )

    tenant, user = await TenantService.signup(
        db,
        company_name=data.company_name,
        full_name=data.full_name,
        email=data.email,
        password=data.password,
    )

    email_sent = False
    try:
        email_sent = await email_service.send_verification_email(db, user.id, user.email, data.full_name)
    except Exception as e:
        logger.warning("Verification email failed (signup continues): %s", e)

    if not email_sent:
        logger.warning("Email sending unavailable; user %s must verify before login", user.email)

    message = (
        "Account created. Please check your email and click the verification link to activate your account."
        if email_sent
        else "Account created. We couldn't send the verification email. Please contact support at info@sshcontrol.com to verify your account."
    )

    return SignupResponse(
        message=message,
        user_id=user.id,
        tenant_id=tenant.id,
        email=user.email,
    )


async def _do_verify(token: str, db: AsyncSession) -> tuple[bool, str]:
    """Shared verification logic. Returns (success, message)."""
    result = await db.execute(
        select(EmailVerificationToken).where(
            EmailVerificationToken.token == token,
            EmailVerificationToken.used == False,  # noqa: E712
        )
    )
    vt = result.scalar_one_or_none()
    if not vt:
        return False, "Invalid or expired verification link."

    now = utcnow_naive()
    if vt.expires_at < now:
        return False, "Verification link has expired. Please request a new one."

    user_result = await db.execute(select(User).where(User.id == vt.user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        return False, "User not found."

    user.email_verified = True
    vt.used = True
    await db.flush()
    return True, "Email verified successfully. You can now log in."


@router.get("/verify-email")
async def verify_email_get(
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Email links hit this GET endpoint directly. The backend verifies the
    token and redirects the browser to the frontend with the result."""
    success, message = await _do_verify(token, db)
    settings = get_settings()
    params = urlencode({"verified": "1" if success else "0", "message": message})
    # HashRouter uses # for routes
    return RedirectResponse(
        url=f"{settings.frontend_url}/#/verify-email?{params}",
        status_code=302,
    )


@router.post("/verify-email")
async def verify_email(data: VerifyEmailRequest, db: Annotated[AsyncSession, Depends(get_db)]):
    success, message = await _do_verify(data.token, db)
    if not success:
        raise HTTPException(status_code=400, detail=message)
    return {"message": message}


@router.post("/resend-verification")
async def resend_verification(data: ResendVerificationRequest, db: Annotated[AsyncSession, Depends(get_db)]):
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
    if not user:
        return {"message": "If an account exists with this email, a verification link has been sent."}

    if user.email_verified:
        return {"message": "Email is already verified."}

    await email_service.send_verification_email(db, user.id, user.email, user.full_name or user.username)
    return {"message": "If an account exists with this email, a verification link has been sent."}


@router.post("/forgot-password")
async def forgot_password(data: ForgotPasswordRequest, db: Annotated[AsyncSession, Depends(get_db)]):
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()

    if user:
        await email_service.send_password_reset_email(
            db, user.id, user.email, user.full_name or user.username
        )

    return {"message": "If an account exists with this email, a password reset link has been sent."}


@router.post("/reset-password")
async def reset_password(data: ResetPasswordRequest, db: Annotated[AsyncSession, Depends(get_db)]):
    result = await db.execute(
        select(PasswordResetToken).where(
            PasswordResetToken.token == data.token,
            PasswordResetToken.used == False,  # noqa: E712
        )
    )
    rt = result.scalar_one_or_none()
    if not rt:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    now = utcnow_naive()
    if rt.expires_at < now:
        raise HTTPException(status_code=400, detail="Reset link has expired. Please request a new one.")

    user_result = await db.execute(select(User).where(User.id == rt.user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.hashed_password = get_password_hash(data.new_password)
    rt.used = True
    await db.flush()

    return {"message": "Password reset successfully. You can now log in with your new password."}


# ─── Account closure (public, via email link) ─────────────────────────────────

@router.get("/confirm-account-closure")
async def confirm_account_closure_get(
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Email link hits this. Verifies token, executes closure, redirects to frontend with result."""
    from urllib.parse import urlencode
    from app.models.tenant import Tenant
    from app.services.tenant_service import TenantService
    from app.services.platform_key_service import PlatformKeyService
    from app.services import sync_service
    from app.config import get_settings

    settings = get_settings()
    result = await db.execute(
        select(AccountClosureToken).where(
            AccountClosureToken.token == token,
            AccountClosureToken.used == False,  # noqa: E712
        )
    )
    act = result.scalar_one_or_none()
    if not act:
        params = urlencode({"error": "Invalid or expired link"})
        return RedirectResponse(url=f"{settings.frontend_url}/#/confirm-account-closure?{params}", status_code=302)
    if utcnow_naive() > act.expires_at:
        params = urlencode({"error": "Link has expired"})
        return RedirectResponse(url=f"{settings.frontend_url}/#/confirm-account-closure?{params}", status_code=302)

    user_result = await db.execute(select(User).where(User.id == act.user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        params = urlencode({"error": "User not found"})
        return RedirectResponse(url=f"{settings.frontend_url}/#/confirm-account-closure?{params}", status_code=302)

    act.used = True
    await db.flush()

    if act.action == "close_user":
        await db.delete(user)
        await db.flush()
        params = urlencode({"closed": "1", "message": "Your account has been closed."})
        return RedirectResponse(url=f"{settings.frontend_url}/#/confirm-account-closure?{params}", status_code=302)

    # close_tenant: unregister servers, then delete tenant
    tenant_id = user.tenant_id
    if not tenant_id:
        params = urlencode({"error": "No tenant to close"})
        return RedirectResponse(url=f"{settings.frontend_url}/#/confirm-account-closure?{params}", status_code=302)

    from app.models.server import Server
    from app.services.stripe_service import cancel_subscription_for_tenant

    # Cancel Stripe subscription so we won't charge the deleted tenant again
    try:
        await cancel_subscription_for_tenant(db, tenant_id, cancel_immediately=True)
    except Exception:
        pass  # Continue with deletion even if Stripe cancel fails

    servers_result = await db.execute(select(Server).where(Server.tenant_id == tenant_id))
    servers = list(servers_result.scalars().all())
    private_key = await PlatformKeyService.get_private_pem(db, tenant_id=tenant_id)
    if private_key and servers:
        for srv in servers:
            try:
                await sync_service.run_unregister_on_server(srv, private_key)
            except Exception:
                pass  # Continue even if unregister fails on some servers

    t = await TenantService.get_tenant(db, tenant_id)
    t.owner_id = None
    await db.flush()
    users_result = await db.execute(select(User).where(User.tenant_id == tenant_id))
    for u in users_result.scalars().all():
        await db.delete(u)
    await db.flush()
    await db.delete(t)
    await db.flush()

    params = urlencode({"closed": "1", "message": "Your organization account has been closed."})
    return RedirectResponse(url=f"{settings.frontend_url}/#/confirm-account-closure?{params}", status_code=302)


@router.get("/plans", response_model=list[PlanResponse])
async def list_public_plans(db: Annotated[AsyncSession, Depends(get_db)]):
    result = await db.execute(
        select(Plan).where(
            Plan.is_active == True,  # noqa: E712
            Plan.is_hidden == False,  # noqa: E712
        ).order_by(Plan.sort_order, Plan.price)
    )
    return result.scalars().all()


@router.get("/platform-settings")
async def get_public_platform_settings(db: Annotated[AsyncSession, Depends(get_db)]):
    """Public endpoint: returns SEO and analytics settings for frontend (no secrets)."""
    result = await db.execute(select(PlatformSettings).where(PlatformSettings.id == "1"))
    cfg = result.scalar_one_or_none()
    if not cfg:
        return {
            "google_analytics_id": "",
            "google_ads_id": "",
            "google_ads_conversion_label": "",
            "google_tag_manager_id": "",
            "google_oauth_client_id": "",
            "recaptcha_site_key": "",
            "seo_site_title": "SSHCONTROL",
            "seo_meta_description": None,
            "seo_keywords": "",
            "seo_og_image_url": "",
            "stripe_enabled": False,
        }
    return {
        "google_analytics_id": cfg.google_analytics_id or "",
        "google_ads_id": cfg.google_ads_id or "",
        "google_ads_conversion_label": cfg.google_ads_conversion_label or "",
        "google_tag_manager_id": cfg.google_tag_manager_id or "",
        "google_oauth_client_id": cfg.google_oauth_client_id or "",
        "recaptcha_site_key": getattr(cfg, "recaptcha_site_key", None) or "",
        "seo_site_title": cfg.seo_site_title or "SSHCONTROL",
        "seo_meta_description": cfg.seo_meta_description,
        "seo_keywords": cfg.seo_keywords or "",
        "seo_og_image_url": cfg.seo_og_image_url or "",
        "stripe_enabled": getattr(cfg, "stripe_enabled", False) or False,
    }


@router.get("/terms")
async def get_terms():
    terms_file = Path(__file__).resolve().parent.parent.parent / "terms-and-conditions.txt"
    if not terms_file.is_file():
        raise HTTPException(status_code=404, detail="Terms and conditions file not found")
    return PlainTextResponse(terms_file.read_text(encoding="utf-8"))


# ─── Invitation accept (public) ──────────────────────────────────────────────

from pydantic import BaseModel as _BM, EmailStr as _ES, Field as _F
from app.models.tenant import UserInvitation, Tenant
import secrets
from app.core.security import get_password_hash as _hash, create_access_token, create_refresh_token


class AcceptInvitationRequest(_BM):
    token: str


@router.get("/invitation")
async def get_invitation_info(
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Return invitation details so the accept form can show who invited them."""
    result = await db.execute(
        select(UserInvitation).where(
            UserInvitation.token == token,
            UserInvitation.accepted == False,  # noqa: E712
        )
    )
    inv = result.scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Invitation not found or already used.")
    now = utcnow_naive()
    if inv.expires_at < now:
        raise HTTPException(status_code=410, detail="This invitation has expired.")

    tenant_r = await db.execute(select(Tenant).where(Tenant.id == inv.tenant_id))
    tenant = tenant_r.scalar_one_or_none()
    inviter = None
    if inv.invited_by:
        inv_r = await db.execute(select(User).where(User.id == inv.invited_by))
        inviter_user = inv_r.scalar_one_or_none()
        inviter = inviter_user.full_name or inviter_user.username if inviter_user else None

    return {
        "email": inv.email,
        "company_name": tenant.company_name if tenant else "",
        "invited_by": inviter,
        "role": inv.role_name,
    }


@router.post("/invitation/accept")
async def accept_invitation(
    data: AcceptInvitationRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Accept an invitation and create the user account."""
    result = await db.execute(
        select(UserInvitation).where(
            UserInvitation.token == data.token,
            UserInvitation.accepted == False,  # noqa: E712
        )
    )
    inv = result.scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=400, detail="Invalid or already used invitation.")
    now = utcnow_naive()
    if inv.expires_at < now:
        raise HTTPException(status_code=410, detail="This invitation has expired.")

    existing = await db.execute(select(User).where(User.email == inv.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    username = inv.email.split("@")[0]
    base_username = username
    counter = 1
    while True:
        check = await db.execute(select(User).where(User.username == username))
        if not check.scalar_one_or_none():
            break
        username = f"{base_username}{counter}"
        counter += 1

    temp_password = secrets.token_urlsafe(32)
    user = User(
        email=inv.email,
        username=username,
        full_name=None,
        hashed_password=_hash(temp_password),
        is_active=True,
        is_superuser=False,
        email_verified=True,
        onboarding_completed=False,
        needs_initial_password=True,
        tenant_id=inv.tenant_id,
    )
    db.add(user)
    await db.flush()

    # Assign the specified role; invited users are never admins unless explicitly set
    if inv.role_name:
        from app.models.role import Role
        from app.models.association import user_roles
        role_r = await db.execute(select(Role).where(Role.name == inv.role_name))
        role = role_r.scalar_one_or_none()
        if role:
            await db.execute(user_roles.insert().values(user_id=user.id, role_id=role.id))

    inv.accepted = True
    await db.flush()

    access = create_access_token(str(user.id))
    refresh = create_refresh_token(str(user.id))
    return {
        "message": "Account created successfully.",
        "email": user.email,
        "access_token": access,
        "refresh_token": refresh,
    }


# ─── Contact form (public) ───────────────────────────────────────────────────

from app.core.rate_limit import RateLimiter
from app.core.request_utils import get_client_ip
from app.services.recaptcha_service import verify_recaptcha

_contact_limiter = RateLimiter(max_requests=5, window_seconds=300)

CONTACT_EMAIL = "info@sshcontrol.com"


class ContactRequest(_BM):
    full_name: str = _F(..., min_length=2, max_length=100)
    email: _ES
    company: str = _F("", max_length=100)
    subject: str = _F(..., min_length=3, max_length=200)
    message: str = _F(..., min_length=10, max_length=5000)
    recaptcha_token: str = _F("", max_length=4096)


@router.post("/contact")
async def submit_contact_form(
    request: Request,
    data: ContactRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Public contact form. Sends message to info@sshcontrol.com via SendGrid."""
    from fastapi import Request as _Req  # noqa: F811

    _contact_limiter.check(request)

    result = await db.execute(select(PlatformSettings).where(PlatformSettings.id == "1"))
    cfg = result.scalar_one_or_none()
    recaptcha_secret = getattr(cfg, "recaptcha_secret_key", "") if cfg else ""
    if recaptcha_secret:
        if not data.recaptcha_token:
            raise HTTPException(status_code=400, detail="Please complete the captcha verification")
        client_ip = get_client_ip(request)
        if not verify_recaptcha(data.recaptcha_token, recaptcha_secret, client_ip):
            raise HTTPException(status_code=400, detail="Captcha verification failed. Please try again.")

    company_line = f"<p><strong>Company:</strong> {data.company}</p>" if data.company.strip() else ""
    html = (
        '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:30px;">'
        '<h2 style="color:#2dd4bf;margin-bottom:20px;">New Contact Form Submission</h2>'
        '<table style="width:100%;border-collapse:collapse;">'
        f'<tr><td style="padding:8px 12px;font-weight:600;color:#94a3b8;width:120px;">Name</td><td style="padding:8px 12px;">{data.full_name}</td></tr>'
        f'<tr><td style="padding:8px 12px;font-weight:600;color:#94a3b8;">Email</td><td style="padding:8px 12px;"><a href="mailto:{data.email}">{data.email}</a></td></tr>'
        + (f'<tr><td style="padding:8px 12px;font-weight:600;color:#94a3b8;">Company</td><td style="padding:8px 12px;">{data.company}</td></tr>' if data.company.strip() else '')
        + f'<tr><td style="padding:8px 12px;font-weight:600;color:#94a3b8;">Subject</td><td style="padding:8px 12px;">{data.subject}</td></tr>'
        '</table>'
        '<hr style="border:none;border-top:1px solid #334155;margin:20px 0;">'
        f'<div style="white-space:pre-wrap;line-height:1.7;color:#e2e8f0;">{data.message}</div>'
        '<hr style="border:none;border-top:1px solid #334155;margin:20px 0;">'
        f'<p style="font-size:0.85em;color:#64748b;">Sent from the SSHCONTROL contact form · IP: {get_client_ip(request)}</p>'
        '</div>'
    )

    from app.services.email_service import _send_email
    sent = await _send_email(
        db,
        to_email=CONTACT_EMAIL,
        subject=f"[Contact] {data.subject}",
        html_content=html,
    )
    if not sent:
        raise HTTPException(status_code=500, detail="Failed to send message. Please try emailing us directly at info@sshcontrol.com.")
    return {"message": "Your message has been sent successfully. We'll get back to you within 24 hours."}
