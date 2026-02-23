import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
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
)
from app.services.auth_service import AuthService
from app.services import audit_service
from app.core.auth import get_current_user, require_superuser
from app.core.rate_limit import login_limiter, totp_limiter, refresh_limiter
from app.models import User

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/login", response_model=LoginResponse)
async def login(
    request: Request,
    data: LoginRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    login_limiter.check(request)
    try:
        user, access, refresh = await AuthService.authenticate(
            db, data.username, data.password, data.totp_code
        )
        try:
            await audit_service.log(
                db, "user_login",
                resource_type="user", resource_id=str(user.id),
                user_id=str(user.id), username=(user.username or ""),
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


@router.get("/me")
async def me(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    from app.schemas.user import UserResponse, RoleBrief, ServerAccessItem
    from app.models import Tenant
    from sqlalchemy import select

    company_name = None
    if current_user.tenant_id:
        r = await db.execute(select(Tenant.company_name).where(Tenant.id == current_user.tenant_id))
        row = r.fetchone()
        company_name = row[0] if row else None
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
        onboarding_completed=getattr(current_user, "onboarding_completed", True),
        needs_initial_password=getattr(current_user, "needs_initial_password", False),
        needs_initial_username=getattr(current_user, "needs_initial_username", False),
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


@router.post("/set-initial-password")
async def set_initial_password(
    data: SetInitialPasswordRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Set username and password for invited users who have needs_initial_password=True."""
    if not getattr(current_user, "needs_initial_password", False):
        raise HTTPException(status_code=400, detail="Initial password already set.")
    if len(data.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
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


@router.post("/request-destructive-verification")
async def request_destructive_verification(
    data: RequestDestructiveVerificationRequest,
    current_user: Annotated[User, Depends(require_superuser)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Send 4-digit verification code to admin's email for destructive action. Admin only."""
    from app.services import email_service

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
    """Verify destructive action via email code or TOTP. Returns short-lived token for delete request."""
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
    else:
        raise HTTPException(status_code=400, detail="Invalid verification type.")

    verification_token = create_destructive_verification_token(
        str(current_user.id), data.action, data.target_id
    )
    return {"verification_token": verification_token}
