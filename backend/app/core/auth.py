from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import User, Role
from app.core.security import decode_token

security = HTTPBearer(auto_error=False)

LAST_SEEN_THROTTLE_SECONDS = 60


async def get_current_user_optional(
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(security)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Optional[User]:
    if not credentials:
        return None
    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != "access":
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    result = await db.execute(
        select(User)
        .options(
            selectinload(User.roles).selectinload(Role.permissions),
            selectinload(User.server_accesses),
        )
        .where(User.id == user_id, User.is_active == True)  # noqa: E712
    )
    user = result.scalar_one_or_none()
    if user:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        last = user.last_seen_at
        if last is None or (now - last) > timedelta(seconds=LAST_SEEN_THROTTLE_SECONDS):
            user.last_seen_at = now
            await db.flush()
    return user


async def get_current_user(
    user: Annotated[Optional[User], Depends(get_current_user_optional)],
) -> User:
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def require_permission(resource: str, action: str):
    """Dependency factory: require permission e.g. resource='users', action='read'."""

    async def _check(
        current_user: Annotated[User, Depends(get_current_user)],
    ) -> User:
        if current_user.is_superuser:
            return current_user
        perm_name = f"{resource}:{action}"
        for role in current_user.roles:
            for perm in role.permissions:
                if perm.name == perm_name:
                    return current_user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permission required: {perm_name}",
        )

    return _check


RequireUsersRead = require_permission("users", "read")
RequireUsersWrite = require_permission("users", "write")
RequireRolesRead = require_permission("roles", "read")
RequireRolesWrite = require_permission("roles", "write")
RequireServersRead = require_permission("servers", "read")
RequireServersWrite = require_permission("servers", "write")


async def require_superuser(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Only superuser or admin role can access."""
    if current_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    if current_user.is_superuser:
        return current_user
    if any(r.name == "admin" for r in (current_user.roles or [])):
        return current_user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")


def verify_destructive_verification_token(
    request: Request,
    current_user: User,
    action: str,
    target_id: str,
) -> None:
    """Validate X-Destructive-Verification header. Raises HTTPException if invalid."""
    from app.core.security import decode_token

    token = request.headers.get("X-Destructive-Verification")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Verification required. Complete the verification step before deleting.",
        )
    payload = decode_token(token)
    if not payload or payload.get("type") != "destructive_verify":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification token. Please verify again.",
        )
    if payload.get("sub") != str(current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Verification token does not match current user.",
        )
    if payload.get("action") != action or payload.get("target_id") != target_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification token does not match this action.",
        )


async def require_platform_superuser(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Only platform superadmin (is_superuser with no tenant) can access."""
    if current_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    if current_user.is_superuser and not current_user.tenant_id:
        return current_user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Platform superadmin access required")
