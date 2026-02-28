import logging
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.config import get_settings
from app.schemas.auth import (
    LoginRequest,
    LoginResponse,
    RefreshRequest,
    TOTPSetupResponse,
    TOTPVerifyRequest,
    TOTPDisableRequest,
    ChangePasswordRequest,
    SetInitialPasswordRequest,
    SetInitialUsernameRequest,
    RequestDestructiveVerificationRequest,
    VerifyDestructiveActionRequest,
    RequestPhoneVerificationRequest,
    VerifyPhoneRequest,
    SmsVerificationToggleRequest,
    RequestAccountClosureRequest,
)
from app.services.auth_service import AuthService
from app.services import audit_service
from app.core.auth import get_current_user, require_superuser
from app.core.rate_limit import login_limiter, totp_limiter, refresh_limiter
from app.core.request_utils import get_client_ip
from app.models import User

router = APIRouter()
logger = logging.getLogger(__name__)


async def _verify_recaptcha_if_required(
    db: AsyncSession, request: Request, token: str | None
) -> None:
    """If reCAPTCHA is configured, verify the token. Raises HTTPException on failure."""
    from sqlalchemy import select
    from app.models.platform_settings import PlatformSettings
    from app.services.recaptcha_service import verify_recaptcha

    r = await db.execute(select(PlatformSettings).where(PlatformSettings.id == "1"))
    cfg = r.scalar_one_or_none()
    if not cfg or not getattr(cfg, "recaptcha_site_key", None) or not getattr(cfg, "recaptcha_secret_key", None):
        return  # reCAPTCHA not configured, skip verification
    secret = getattr(cfg, "recaptcha_secret_key", "") or ""
    if not secret:
        return
    if not token:
        raise HTTPException(status_code=400, detail="Please complete the captcha verification")
    client_ip = get_client_ip(request)
    if not verify_recaptcha(token, secret, client_ip):
        raise HTTPException(status_code=400, detail="Captcha verification failed. Please try again.")


@router.post("/login")
async def login(
    request: Request,
    data: LoginRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    login_limiter.check(request)
    if not (data.pending_token and data.sms_code):
        await _verify_recaptcha_if_required(db, request, data.recaptcha_token)

    from app.models.tenant import LoginSmsToken
    from app.models.user import utcnow_naive
    from datetime import timedelta
    from sqlalchemy import select, delete
    import secrets
    from app.core.security import create_access_token, create_refresh_token, create_login_sms_pending_token, decode_token
    from app.services import sms_service

    # If pending_token + sms_code: verify SMS and complete login (no username/password needed)
    if data.pending_token and data.sms_code:
        payload = decode_token(data.pending_token)
        if not payload or payload.get("type") != "login_sms_pending":
            raise HTTPException(status_code=400, detail="Invalid or expired verification. Please log in again.")
        user_id = payload.get("sub")
        jti = payload.get("jti")
        result = await db.execute(select(LoginSmsToken).where(LoginSmsToken.id == jti, LoginSmsToken.user_id == user_id))
        token_row = result.scalar_one_or_none()
        if not token_row:
            raise HTTPException(status_code=400, detail="Verification expired. Please log in again.")
        if utcnow_naive() > token_row.expires_at:
            await db.execute(delete(LoginSmsToken).where(LoginSmsToken.id == jti))
            await db.flush()
            raise HTTPException(status_code=400, detail="Verification code expired. Please log in again.")
        if token_row.code != data.sms_code.strip():
            raise HTTPException(status_code=401, detail="Invalid SMS code.")
        await db.execute(delete(LoginSmsToken).where(LoginSmsToken.id == jti))
        await db.flush()
        user_result = await db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()
        if not user or not user.is_active:
            raise HTTPException(status_code=401, detail="User not found or inactive.")
        access = create_access_token(str(user.id))
        refresh = create_refresh_token(str(user.id))
        try:
            await audit_service.log(db, "user_login", resource_type="user", resource_id=str(user.id),
                user_id=str(user.id), username=(user.username or ""), ip_address=get_client_ip(request),
                details="username=" + (user.username or "") + ",sms_verified")
        except Exception as e:
            logger.warning("Audit log failed on login: %s", e)
        return LoginResponse(access_token=access, refresh_token=refresh, token_type="bearer",
            user_id=str(user.id), username=(user.username or ""), email=(user.email or ""))

    if not data.username or not data.password:
        raise HTTPException(status_code=400, detail="Username and password are required.")

    try:
        user, access, refresh = await AuthService.authenticate(
            db, data.username, data.password, data.totp_code
        )
        if getattr(user, "sms_verification_enabled", False):
            phone = getattr(user, "phone", None) or ""
            if not phone or not getattr(user, "phone_verified", False):
                raise HTTPException(status_code=400, detail="SMS verification is enabled but phone is not verified. Contact your administrator.")
            code = "".join(secrets.choice("0123456789") for _ in range(4))
            now = utcnow_naive()
            expires_at = now + timedelta(minutes=5)
            await db.execute(delete(LoginSmsToken).where(LoginSmsToken.user_id == str(user.id)))
            await db.flush()
            token = LoginSmsToken(user_id=str(user.id), code=code, expires_at=expires_at)
            db.add(token)
            await db.flush()
            sent, _ = await sms_service.send_sms(db, phone, f"Your SSHCONTROL login verification code is: {code}")
            if not sent:
                raise HTTPException(status_code=503, detail="Could not send SMS. Contact your administrator.")
            pending = create_login_sms_pending_token(str(user.id), token.id)
            return {"requires_sms": True, "pending_token": pending}
        try:
            await audit_service.log(
                db, "user_login",
                resource_type="user", resource_id=str(user.id),
                user_id=str(user.id), username=(user.username or ""),
                ip_address=get_client_ip(request),
                details=f"username={user.username or ''}",
            )
        except Exception as e:
            logger.warning("Audit log failed on login (login continues): %s", e)
        return LoginResponse(
            access_token=access,
            refresh_token=refresh,
            token_type="bearer",
            user_id=str(user.id),
            username=(user.username or ""),
            email=(user.email or ""),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Login endpoint error: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Login failed. Please try again later.",
        )


@router.post("/refresh")
async def refresh(
    request: Request,
    data: RefreshRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    refresh_limiter.check(request)
    try:
        access, new_refresh = await AuthService.refresh_tokens(db, data.refresh_token)
        return {"access_token": access, "refresh_token": new_refresh, "token_type": "bearer"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Refresh endpoint error: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Token refresh failed. Please try again later.",
        )


# ─── Google OAuth ─────────────────────────────────────────────────────────────

@router.get("/google")
async def google_oauth_start(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    mode: str = Query("login", description="login or signup"),
    accept_terms: bool = Query(False, description="Required true for signup"),
):
    """Redirect to Google OAuth. mode=login|signup. For signup, accept_terms must be true."""
    from app.models.platform_settings import PlatformSettings
    from app.services.google_oauth_service import build_authorization_url, create_state

    r = await db.execute(select(PlatformSettings).where(PlatformSettings.id == "1"))
    cfg = r.scalar_one_or_none()
    client_id = getattr(cfg, "google_oauth_client_id", None) or "" if cfg else ""
    client_secret = getattr(cfg, "google_oauth_client_secret", None) or "" if cfg else ""
    if not client_id or not client_secret:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")

    if mode not in ("login", "signup"):
        raise HTTPException(status_code=400, detail="Invalid mode")
    if mode == "signup" and not accept_terms:
        raise HTTPException(status_code=400, detail="You must accept the terms to sign up")

    settings = get_settings()
    # redirect_uri must match exactly what's in Google Cloud Console (e.g. https://sshcontrol.com/api/auth/google/callback)
    api_url = getattr(settings, "public_api_url", None) or str(request.base_url).rstrip("/")
    redirect_uri = f"{api_url.rstrip('/')}/api/auth/google/callback"
    state = create_state(mode, settings.secret_key, accept_terms=(mode == "signup"))
    url = build_authorization_url(client_id, redirect_uri, state)
    return RedirectResponse(url=url)


@router.get("/google/callback")
async def google_oauth_callback(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
):
    """Handle Google OAuth callback. Redirect to frontend with tokens or error."""
    from app.models.platform_settings import PlatformSettings
    from app.services.google_oauth_service import (
        verify_state,
        exchange_code_for_tokens,
        get_user_info,
    )
    from app.services.tenant_service import TenantService

    settings = get_settings()
    frontend_url = settings.frontend_url.rstrip("/")

    def err_redirect(msg: str, to_signup: bool = False) -> RedirectResponse:
        # HashRouter: use /#/path?query format
        path = "signup" if to_signup else "login"
        return RedirectResponse(url=f"{frontend_url}/#/{path}?error={quote(msg)}")

    if error:
        return err_redirect(error if len(error) < 100 else "Authorization denied")

    if not code or not state:
        return err_redirect("Missing code or state")

    verified = verify_state(state, settings.secret_key)
    if not verified:
        return err_redirect("Invalid state")

    mode, accept_terms = verified
    if mode == "signup" and not accept_terms:
        return err_redirect("Terms must be accepted")

    r = await db.execute(select(PlatformSettings).where(PlatformSettings.id == "1"))
    cfg = r.scalar_one_or_none()
    client_id = getattr(cfg, "google_oauth_client_id", None) or "" if cfg else ""
    client_secret = getattr(cfg, "google_oauth_client_secret", None) or "" if cfg else ""
    if not client_id or not client_secret:
        return err_redirect("Google sign-in not configured")

    # Must match exactly what's in Google Cloud Console (e.g. https://sshcontrol.com/api/auth/google/callback)
    api_url = getattr(settings, "public_api_url", None) or str(request.base_url).rstrip("/")
    redirect_uri = f"{api_url.rstrip('/')}/api/auth/google/callback"

    try:
        tokens = await exchange_code_for_tokens(code, client_id, client_secret, redirect_uri)
    except ValueError as e:
        logger.warning("Google token exchange failed: %s", e)
        return err_redirect("Token exchange failed")

    access_token = tokens.get("access_token")
    if not access_token:
        return err_redirect("No access token")

    try:
        info = await get_user_info(access_token)
    except ValueError as e:
        logger.warning("Google userinfo failed: %s", e)
        return err_redirect("Failed to get user info")

    google_id = info.get("google_id")
    email = info.get("email")
    full_name = info.get("name") or ""

    if not email or not google_id:
        return err_redirect("Email not provided by Google")

    try:
        auth_result = await AuthService.authenticate_google(db, email, google_id)
    except Exception as e:
        logger.exception("Google OAuth authenticate_google failed: %s", e)
        msg = "Sign-up failed. Please try again." if mode == "signup" else "Sign-in failed. Please try again."
        return err_redirect(msg, to_signup=(mode == "signup"))

    if auth_result:
        user, access, refresh = auth_result
        try:
            await audit_service.log(
                db, "user_login",
                resource_type="user", resource_id=str(user.id),
                user_id=str(user.id), username=(user.username or ""),
                ip_address=get_client_ip(request),
                details="google_oauth",
            )
        except Exception as e:
            logger.warning("Audit log failed on Google login: %s", e)
        params = f"access_token={quote(access)}&refresh_token={quote(refresh)}"
        return RedirectResponse(url=f"{frontend_url}/#/auth/callback?{params}")

    if mode == "login":
        return err_redirect("No account found. Please sign up first")

    try:
        tenant, new_user = await TenantService.signup_with_google(
            db, email=email, full_name=full_name, google_id=google_id
        )
        try:
            await audit_service.log(
                db, "user_signup",
                resource_type="user", resource_id=str(new_user.id),
                user_id=str(new_user.id), username=new_user.username or "",
                ip_address=get_client_ip(request),
                details="google_oauth_signup",
            )
        except Exception as e:
            logger.warning("Audit log failed on Google signup: %s", e)
        from app.core.security import create_access_token, create_refresh_token
        access = create_access_token(str(new_user.id))
        refresh = create_refresh_token(str(new_user.id))
        params = f"access_token={quote(access)}&refresh_token={quote(refresh)}"
        return RedirectResponse(url=f"{frontend_url}/#/auth/callback?{params}")
    except HTTPException as he:
        if he.status_code == 409:
            return err_redirect("Account already exists. Sign in instead", to_signup=True)
        logger.exception("Google OAuth signup HTTPException: %s", he)
        return err_redirect(he.detail if isinstance(he.detail, str) else "Sign-up failed", to_signup=True)
    except Exception as e:
        logger.exception("Google OAuth signup failed: %s", e)
        return err_redirect("Sign-up failed. Please try again.", to_signup=True)


@router.get("/client-ip")
async def client_ip(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Return the client's IP address (for display in sidebar)."""
    return {"client_ip": get_client_ip(request)}


@router.get("/me")
async def me(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    from app.schemas.user import UserResponse, RoleBrief, ServerAccessItem
    from app.models import Tenant
    from sqlalchemy import select

    company_name = None
    is_tenant_owner = False
    if current_user.tenant_id:
        r = await db.execute(select(Tenant.company_name, Tenant.owner_id).where(Tenant.id == current_user.tenant_id))
        row = r.fetchone()
        if row:
            company_name = row[0]
            is_tenant_owner = str(row[1]) == str(current_user.id) if row[1] else False
    elif current_user.is_superuser and not current_user.tenant_id:
        company_name = "Platform"

    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        username=current_user.username,
        full_name=getattr(current_user, "full_name", None),
        phone=getattr(current_user, "phone", None),
        is_active=current_user.is_active,
        is_superuser=current_user.is_superuser,
        totp_enabled=current_user.totp_enabled,
        email_verified=getattr(current_user, "email_verified", True),
        phone_verified=getattr(current_user, "phone_verified", False),
        sms_verification_enabled=getattr(current_user, "sms_verification_enabled", False),
        onboarding_completed=getattr(current_user, "onboarding_completed", True),
        needs_initial_password=getattr(current_user, "needs_initial_password", False),
        needs_initial_username=getattr(current_user, "needs_initial_username", False),
        is_google_user=bool(getattr(current_user, "google_id", None)),
        is_tenant_owner=is_tenant_owner,
        tenant_id=getattr(current_user, "tenant_id", None),
        company_name=company_name,
        created_at=current_user.created_at,
        roles=[RoleBrief(id=r.id, name=r.name) for r in current_user.roles],
        server_access=[
            ServerAccessItem(server_id=sa.server_id, role=sa.role)
            for sa in getattr(current_user, "server_accesses", []) or []
        ],
    )


@router.post("/totp/setup", response_model=TOTPSetupResponse)
async def totp_setup(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    secret, uri = await AuthService.setup_totp(db, current_user)
    return TOTPSetupResponse(
        secret=secret,
        provisioning_uri=uri,
        qr_uri=uri,
    )


@router.post("/totp/verify")
async def totp_verify(
    request: Request,
    data: TOTPVerifyRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    totp_limiter.check(request)
    await AuthService.enable_totp(db, current_user, data.code)
    return {"message": "TOTP enabled"}


@router.post("/totp/disable")
async def totp_disable(
    data: TOTPDisableRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await AuthService.disable_totp(db, current_user, data.password)
    return {"message": "TOTP disabled"}


@router.post("/complete-onboarding")
async def complete_onboarding(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Mark onboarding as completed for the current user."""
    current_user.onboarding_completed = True
    await db.flush()
    return {"message": "Onboarding completed"}


@router.get("/plan-limits")
async def get_plan_limits(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Get current user's tenant plan limits and usage."""
    if not current_user.tenant_id:
        return {"plan_name": "N/A", "max_users": 999, "max_servers": 999, "current_users": 0, "current_servers": 0, "pending_invitations": 0}

    from app.services.tenant_service import TenantService
    limits = await TenantService.get_plan_limits(db, current_user.tenant_id)
    current_users = await TenantService.count_tenant_users(db, current_user.tenant_id)
    current_servers = await TenantService.count_tenant_servers(db, current_user.tenant_id)
    pending_invitations = await TenantService.count_tenant_pending_invitations(db, current_user.tenant_id)

    return {
        "plan_name": limits.get("plan_name", "None"),
        "plan_id": limits.get("plan_id"),
        "max_users": limits.get("max_users", 0),
        "max_servers": limits.get("max_servers", 0),
        "current_users": current_users,
        "current_servers": current_servers,
        "pending_invitations": pending_invitations,
        "starts_at": limits.get("starts_at"),
        "expires_at": limits.get("expires_at"),
    }


@router.post("/change-password")
async def change_password(
    data: ChangePasswordRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Change current user's password. Requires current password."""
    await AuthService.change_password(
        db, current_user,
        data.current_password,
        data.new_password,
    )
    return {"message": "Password changed"}


@router.get("/check-username")
async def check_username(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    username: str = Query(..., min_length=2, max_length=100),
):
    """Check if username is available (not taken by another user). Used during onboarding before setting password."""
    uname = username.strip()
    if len(uname) < 2:
        return {"available": False}
    existing = await db.execute(select(User).where(User.username == uname, User.id != current_user.id))
    return {"available": existing.scalar_one_or_none() is None}


@router.post("/set-initial-password")
async def set_initial_password(
    data: SetInitialPasswordRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Set username and password for invited users who have needs_initial_password=True."""
    if not getattr(current_user, "needs_initial_password", False):
        raise HTTPException(status_code=400, detail="Initial password already set.")
    username = data.username.strip()
    if len(username) < 2:
        raise HTTPException(status_code=400, detail="Username must be at least 2 characters.")
    # Check username uniqueness (username is globally unique)
    from sqlalchemy import select
    existing = await db.execute(select(User).where(User.username == username, User.id != current_user.id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="This username is already taken.")
    from app.core.security import get_password_hash
    current_user.username = username
    current_user.hashed_password = get_password_hash(data.new_password)
    current_user.needs_initial_password = False
    await db.flush()
    return {"message": "Account setup complete"}


@router.post("/set-initial-username")
async def set_initial_username(
    data: SetInitialUsernameRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Set username for admin signup users who have needs_initial_username=True."""
    if not getattr(current_user, "needs_initial_username", False):
        raise HTTPException(status_code=400, detail="Initial username already set.")
    username = data.username.strip()
    if len(username) < 2:
        raise HTTPException(status_code=400, detail="Username must be at least 2 characters.")
    from sqlalchemy import select
    existing = await db.execute(select(User).where(User.username == username, User.id != current_user.id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="This username is already taken.")
    current_user.username = username
    current_user.needs_initial_username = False
    await db.flush()
    return {"message": "Username set"}


@router.post("/request-phone-verification")
async def request_phone_verification(
    data: RequestPhoneVerificationRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Send 4-digit verification code via SMS. User must verify to set phone (locks editing after verification)."""
    from app.models.tenant import PhoneVerificationToken
    from app.models.user import utcnow_naive
    from datetime import timedelta
    from sqlalchemy import delete
    import secrets
    from app.services import sms_service

    if getattr(current_user, "phone_verified", False):
        raise HTTPException(status_code=400, detail="Phone is already verified. Contact your administrator to change it.")

    code = "".join(secrets.choice("0123456789") for _ in range(4))
    now = utcnow_naive()
    expires_at = now + timedelta(minutes=10)

    await db.execute(delete(PhoneVerificationToken).where(PhoneVerificationToken.user_id == str(current_user.id)))
    await db.flush()

    token = PhoneVerificationToken(
        user_id=str(current_user.id),
        phone=data.phone,
        code=code,
        expires_at=expires_at,
    )
    db.add(token)
    await db.flush()

    sent, _ = await sms_service.send_sms(db, data.phone, f"Your SSHCONTROL verification code is: {code}")
    if not sent:
        raise HTTPException(status_code=503, detail="Could not send SMS. Check SMS configuration.")
    return {"message": "Verification code sent to your phone."}


@router.post("/verify-phone")
async def verify_phone(
    data: VerifyPhoneRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Verify phone with code. Sets phone and phone_verified=True. Phone becomes read-only for user after this."""
    from app.models.tenant import PhoneVerificationToken
    from app.models.user import utcnow_naive
    from sqlalchemy import select, delete

    result = await db.execute(
        select(PhoneVerificationToken).where(
            PhoneVerificationToken.user_id == str(current_user.id),
            PhoneVerificationToken.phone == data.phone,
        ).order_by(PhoneVerificationToken.created_at.desc()).limit(1)
    )
    token_row = result.scalar_one_or_none()
    if not token_row:
        raise HTTPException(status_code=400, detail="No verification code found. Request a new one.")
    if utcnow_naive() > token_row.expires_at:
        await db.execute(delete(PhoneVerificationToken).where(PhoneVerificationToken.id == token_row.id))
        await db.flush()
        raise HTTPException(status_code=400, detail="Verification code expired. Request a new one.")
    if token_row.code != data.code.strip():
        raise HTTPException(status_code=400, detail="Invalid verification code.")

    current_user.phone = data.phone
    current_user.phone_verified = True
    await db.execute(delete(PhoneVerificationToken).where(PhoneVerificationToken.id == token_row.id))
    await db.flush()
    return {"message": "Phone verified. It can no longer be changed by you; contact your administrator if needed."}


@router.post("/sms-verification/toggle")
async def toggle_sms_verification(
    data: SmsVerificationToggleRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Enable or disable SMS verification for login and destructive actions (like 2FA toggle). Password required when disabling."""
    if data.enabled and not getattr(current_user, "phone_verified", False):
        raise HTTPException(
            status_code=400,
            detail="Verify your phone number first (Profile → Security) before enabling SMS verification.",
        )
    if not data.enabled:
        if not data.password:
            raise HTTPException(status_code=400, detail="Password required to disable SMS verification.")
        from app.core.security import verify_password
        if not verify_password(data.password, current_user.hashed_password):
            raise HTTPException(status_code=401, detail="Invalid password.")
    current_user.sms_verification_enabled = data.enabled
    await db.flush()
    return {"message": f"SMS verification {'enabled' if data.enabled else 'disabled'}."}


@router.post("/request-destructive-verification")
async def request_destructive_verification(
    data: RequestDestructiveVerificationRequest,
    current_user: Annotated[User, Depends(require_superuser)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Send 4-digit verification code to admin's email or SMS for destructive action. Admin only.
    For refund_transaction and recharge_transaction, platform superadmin only."""
    if data.action in ("refund_transaction", "recharge_transaction"):
        if not current_user.is_superuser or current_user.tenant_id:
            raise HTTPException(status_code=403, detail="Platform superadmin only")
    from app.services import email_service
    from app.services import sms_service
    from app.models.tenant import DestructiveVerificationToken, PhoneVerificationToken
    from app.models.user import utcnow_naive
    from datetime import timedelta
    from sqlalchemy import delete
    import secrets

    code = "".join(secrets.choice("0123456789") for _ in range(4))
    now = utcnow_naive()
    expires_at = now + timedelta(minutes=10)

    if data.channel == "sms":
        phone = getattr(current_user, "phone", None) or ""
        if not phone or not getattr(current_user, "phone_verified", False):
            raise HTTPException(status_code=400, detail="No verified phone on file. Add and verify your phone in Profile → Security first.")
        await db.execute(
            delete(DestructiveVerificationToken).where(
                DestructiveVerificationToken.user_id == str(current_user.id),
                DestructiveVerificationToken.action == data.action,
            )
        )
        await db.flush()
        token = DestructiveVerificationToken(
            user_id=str(current_user.id),
            action=data.action,
            target_id=data.target_id,
            code=code,
            expires_at=expires_at,
            created_at=now,
        )
        db.add(token)
        await db.flush()
        action_label = {
            "delete_server": "remove a server",
            "delete_user": "remove a user",
            "delete_server_group": "remove a server group",
            "delete_user_group": "remove a user group",
            "refund_transaction": "refund a payment",
            "recharge_transaction": "recharge a payment",
        }.get(data.action, data.action)
        msg = f"SSHCONTROL: Your verification code to {action_label} ({data.target_name}) is {code}. Expires in 10 min."
        sent, _ = await sms_service.send_sms(db, phone, msg)
        if not sent:
            raise HTTPException(status_code=503, detail="Could not send SMS. Check SMS configuration.")
        return {"message": "Verification code sent to your phone."}

    email = current_user.email or ""
    if not email:
        raise HTTPException(status_code=400, detail="No email on file. Add an email to your profile first.")
    sent, _code = await email_service.send_destructive_verification_email(
        db,
        user_id=str(current_user.id),
        email=email,
        full_name=current_user.full_name or current_user.username,
        action=data.action,
        target_id=data.target_id,
        target_name=data.target_name,
    )
    if not sent:
        raise HTTPException(
            status_code=503,
            detail="Could not send verification email. Check email configuration.",
        )
    return {"message": "Verification code sent to your email."}


@router.post("/verify-destructive-action")
async def verify_destructive_action(
    data: VerifyDestructiveActionRequest,
    current_user: Annotated[User, Depends(require_superuser)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Verify destructive action via email code or TOTP. Returns short-lived token for delete request.
    For refund_transaction and recharge_transaction, password is required (platform superadmin only)."""
    if data.action in ("refund_transaction", "recharge_transaction"):
        if not current_user.is_superuser or current_user.tenant_id:
            raise HTTPException(status_code=403, detail="Platform superadmin only")
        if not data.password or not data.password.strip():
            raise HTTPException(status_code=400, detail="Password is required for this action.")
        from app.core.security import verify_password
        if not verify_password(data.password, current_user.hashed_password):
            raise HTTPException(status_code=401, detail="Invalid password.")
    from app.models.tenant import DestructiveVerificationToken
    from app.models.user import utcnow_naive
    from sqlalchemy import select, delete
    from app.core.security import verify_totp, create_destructive_verification_token

    if data.verification_type == "email":
        result = await db.execute(
            select(DestructiveVerificationToken).where(
                DestructiveVerificationToken.user_id == str(current_user.id),
                DestructiveVerificationToken.action == data.action,
                DestructiveVerificationToken.target_id == data.target_id,
            ).order_by(DestructiveVerificationToken.created_at.desc()).limit(1)
        )
        token_row = result.scalar_one_or_none()
        if not token_row:
            raise HTTPException(status_code=400, detail="No verification code found. Request a new one.")
        if utcnow_naive() > token_row.expires_at:
            await db.execute(delete(DestructiveVerificationToken).where(DestructiveVerificationToken.id == token_row.id))
            await db.flush()
            raise HTTPException(status_code=400, detail="Verification code expired. Request a new one.")
        if token_row.code != data.code.strip():
            raise HTTPException(status_code=400, detail="Invalid verification code.")
        await db.execute(delete(DestructiveVerificationToken).where(DestructiveVerificationToken.id == token_row.id))
        await db.flush()
    elif data.verification_type == "totp":
        if not current_user.totp_enabled or not current_user.totp_secret:
            raise HTTPException(status_code=400, detail="2FA is not enabled. Use email verification.")
        if not verify_totp(current_user.totp_secret, data.code):
            raise HTTPException(status_code=400, detail="Invalid 2FA code.")
    elif data.verification_type == "sms":
        if not getattr(current_user, "phone_verified", False):
            raise HTTPException(status_code=400, detail="Phone not verified. Use email or 2FA.")
        result = await db.execute(
            select(DestructiveVerificationToken).where(
                DestructiveVerificationToken.user_id == str(current_user.id),
                DestructiveVerificationToken.action == data.action,
                DestructiveVerificationToken.target_id == data.target_id,
            ).order_by(DestructiveVerificationToken.created_at.desc()).limit(1)
        )
        token_row = result.scalar_one_or_none()
        if not token_row:
            raise HTTPException(status_code=400, detail="No verification code found. Request a new one.")
        if utcnow_naive() > token_row.expires_at:
            await db.execute(delete(DestructiveVerificationToken).where(DestructiveVerificationToken.id == token_row.id))
            await db.flush()
            raise HTTPException(status_code=400, detail="Verification code expired. Request a new one.")
        if token_row.code != data.code.strip():
            raise HTTPException(status_code=400, detail="Invalid verification code.")
        await db.execute(delete(DestructiveVerificationToken).where(DestructiveVerificationToken.id == token_row.id))
        await db.flush()
    else:
        raise HTTPException(status_code=400, detail="Invalid verification type.")

    verification_token = create_destructive_verification_token(
        str(current_user.id), data.action, data.target_id
    )
    return {"verification_token": verification_token}


@router.post("/request-account-closure")
async def request_account_closure(
    data: RequestAccountClosureRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Request account closure. Verifies password, 2FA (if enabled), SMS (if enabled), then sends confirmation link to email."""
    try:
        return await _request_account_closure_impl(data, db, current_user)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("request_account_closure failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Account closure request failed: {str(e)}")


async def _request_account_closure_impl(
    data: RequestAccountClosureRequest,
    db: AsyncSession,
    current_user: User,
):
    from app.core.security import verify_password, verify_totp
    from app.models.tenant import DestructiveVerificationToken, PhoneVerificationToken, AccountClosureToken
    from app.services import email_service
    from app.models.user import utcnow_naive
    from datetime import timedelta
    from sqlalchemy import delete
    import secrets
    from app.services import sms_service

    # Determine action: close_tenant for tenant admin, close_user for regular user
    is_admin = current_user.is_superuser or any(r.name == "admin" for r in (current_user.roles or []))
    action = "close_tenant" if (is_admin and current_user.tenant_id) else "close_user"

    # Platform superadmin cannot close via this (no tenant)
    if current_user.is_superuser and not current_user.tenant_id:
        raise HTTPException(status_code=400, detail="Platform superadmin cannot close account via this flow.")

    # 1. Verify password (skip for Google-only users and invited users who never set a real password)
    is_google_user = bool(getattr(current_user, "google_id", None))
    needs_initial_password = getattr(current_user, "needs_initial_password", False)
    skip_password = is_google_user or needs_initial_password
    if not skip_password:
        if not data.password or not data.password.strip():
            raise HTTPException(status_code=400, detail="Password is required.")
        if not verify_password(data.password, current_user.hashed_password):
            raise HTTPException(status_code=401, detail="Invalid password.")

    # 2. If pending_sms_token + sms_code: verify SMS (second step of SMS flow)
    if data.pending_sms_token and data.sms_code:
        from app.core.security import decode_token
        payload = decode_token(data.pending_sms_token)
        if not payload or payload.get("type") != "account_closure_sms_pending":
            raise HTTPException(status_code=400, detail="Invalid or expired verification. Please start over.")
        jti = payload.get("jti")
        result = await db.execute(
            select(DestructiveVerificationToken).where(
                DestructiveVerificationToken.id == jti,
                DestructiveVerificationToken.user_id == str(current_user.id),
                DestructiveVerificationToken.action == "account_closure_sms",
            )
        )
        token_row = result.scalar_one_or_none()
        if not token_row or utcnow_naive() > token_row.expires_at:
            await db.execute(delete(DestructiveVerificationToken).where(DestructiveVerificationToken.id == jti))
            await db.flush()
            raise HTTPException(status_code=400, detail="SMS code expired. Request a new one.")
        if token_row.code != data.sms_code.strip():
            raise HTTPException(status_code=401, detail="Invalid SMS code.")
        await db.execute(delete(DestructiveVerificationToken).where(DestructiveVerificationToken.id == jti))
        await db.flush()
    elif getattr(current_user, "sms_verification_enabled", False):
        # SMS required but not provided - send SMS and return pending token
        phone = getattr(current_user, "phone", None) or ""
        if not phone or not getattr(current_user, "phone_verified", False):
            raise HTTPException(status_code=400, detail="SMS verification is enabled but no verified phone. Contact your administrator.")
        code = "".join(secrets.choice("0123456789") for _ in range(4))
        now = utcnow_naive()
        expires_at = now + timedelta(minutes=10)
        await db.execute(
            delete(DestructiveVerificationToken).where(
                DestructiveVerificationToken.user_id == str(current_user.id),
                DestructiveVerificationToken.action == "account_closure_sms",
            )
        )
        await db.flush()
        from app.core.security import create_access_token
        token_row = DestructiveVerificationToken(
            user_id=str(current_user.id),
            action="account_closure_sms",
            target_id="account_closure",
            code=code,
            expires_at=expires_at,
            created_at=now,
        )
        db.add(token_row)
        await db.flush()
        msg = f"SSHCONTROL: Your verification code to close your account is {code}. Expires in 10 min."
        sent, _ = await sms_service.send_sms(db, phone, msg)
        if not sent:
            raise HTTPException(status_code=503, detail="Could not send SMS. Check SMS configuration.")
        from app.core.security import create_account_closure_sms_pending_token
        pending = create_account_closure_sms_pending_token(str(current_user.id), token_row.id)
        return {"requires_sms": True, "pending_token": pending, "message": "Verification code sent to your phone."}

    # 3. If TOTP enabled, verify totp_code
    if current_user.totp_enabled and current_user.totp_secret:
        if not data.totp_code or not data.totp_code.strip():
            raise HTTPException(status_code=400, detail="2FA code is required.")
        if not verify_totp(current_user.totp_secret, data.totp_code.strip()):
            raise HTTPException(status_code=401, detail="Invalid 2FA code.")

    # All verified - create token and send email
    sent, _ = await email_service.send_account_closure_email(
        db,
        user_id=str(current_user.id),
        email=current_user.email or "",
        full_name=current_user.full_name or current_user.username,
        action=action,
        is_admin=action == "close_tenant",
    )
    if not sent:
        raise HTTPException(
            status_code=503,
            detail="Could not send confirmation email. Check email configuration.",
        )
    return {"message": "A confirmation link has been sent to your email. Click it to close your account."}
