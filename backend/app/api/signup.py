"""Public endpoints: signup, email verification, forgot/reset password."""

import logging
from pathlib import Path
from typing import Annotated

from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import PlainTextResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import User
from app.models.tenant import EmailVerificationToken, PasswordResetToken
from app.models.user import utcnow_naive
from app.schemas.tenant import (
    SignupRequest, SignupResponse,
    VerifyEmailRequest, ForgotPasswordRequest, ResetPasswordRequest,
    ResendVerificationRequest, PlanResponse,
)
from app.models.tenant import Plan
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


@router.get("/plans", response_model=list[PlanResponse])
async def list_public_plans(db: Annotated[AsyncSession, Depends(get_db)]):
    result = await db.execute(
        select(Plan).where(
            Plan.is_active == True,  # noqa: E712
            Plan.is_hidden == False,  # noqa: E712
        ).order_by(Plan.sort_order, Plan.price)
    )
    return result.scalars().all()


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
