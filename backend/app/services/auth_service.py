import logging
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, func
from fastapi import HTTPException, status

from app.models import User

logger = logging.getLogger(__name__)
from app.core.security import (
    verify_password,
    get_password_hash,
    create_access_token,
    create_refresh_token,
    decode_token,
    generate_totp_secret,
    get_totp_uri,
    verify_totp,
    validate_password_strength,
)


_DUMMY_HASH = get_password_hash("__timing_oracle_dummy__")


class AuthService:
    @staticmethod
    async def authenticate(
        db: AsyncSession,
        username: str,
        password: str,
        totp_code: Optional[str] = None,
    ) -> tuple[User, str, str]:
        # Case-insensitive match for username/email (e.g. User@Email.com vs user@email.com)
        ident = username.strip().lower()
        result = await db.execute(
            select(User).where(or_(
                func.lower(User.username) == ident,
                func.lower(User.email) == ident,
            ))
        )
        user = result.scalar_one_or_none()
        if not user or not user.is_active:
            # Always run bcrypt to prevent timing-based user enumeration
            verify_password(password, _DUMMY_HASH)
            logger.info("Login failed: no active user for identifier %r", username)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password",
            )
        if not verify_password(password, user.hashed_password):
            logger.info("Login failed: invalid password for user %r", user.username)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password",
            )
        if not user.email_verified:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Please verify your email before logging in. Check your inbox for the verification link.",
            )
        if user.totp_enabled:
            if not totp_code:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="TOTP code required",
                )
            if not user.totp_secret or not verify_totp(user.totp_secret, totp_code):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid TOTP code",
                )
        access = create_access_token(str(user.id))
        refresh = create_refresh_token(str(user.id))
        return user, access, refresh

    @staticmethod
    async def authenticate_google(
        db: AsyncSession,
        email: str,
        google_id: str,
    ) -> tuple[User, str, str] | None:
        """Find user by email or google_id. Returns (user, access, refresh) or None if not found."""
        from sqlalchemy import or_
        result = await db.execute(
            select(User)
            .where(
                User.is_active == True,  # noqa: E712
                or_(User.email == email, User.google_id == google_id),
            )
            .limit(1)
        )
        user = result.scalars().first()
        if not user:
            return None
        if not user.email_verified:
            user.email_verified = True
            await db.flush()
        if not user.google_id:
            user.google_id = google_id
            await db.flush()
        access = create_access_token(str(user.id))
        refresh = create_refresh_token(str(user.id))
        return user, access, refresh

    @staticmethod
    async def refresh_tokens(db: AsyncSession, refresh_token: str) -> tuple[str, str]:
        payload = decode_token(refresh_token)
        if not payload or payload.get("type") != "refresh":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid refresh token",
            )
        user_id = payload.get("sub")
        result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))  # noqa: E712
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive",
            )
        access = create_access_token(str(user.id))
        new_refresh = create_refresh_token(str(user.id))
        return access, new_refresh

    @staticmethod
    async def setup_totp(db: AsyncSession, user: User) -> tuple[str, str]:
        if user.totp_enabled:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="TOTP already enabled",
            )
        secret = generate_totp_secret()
        user.totp_secret = secret
        await db.flush()
        uri = get_totp_uri(secret, user.username)
        return secret, uri

    @staticmethod
    async def enable_totp(db: AsyncSession, user: User, code: str) -> None:
        if not user.totp_secret:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="TOTP not set up. Call setup first.",
            )
        if not verify_totp(user.totp_secret, code):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid TOTP code",
            )
        user.totp_enabled = True
        await db.flush()

    @staticmethod
    async def disable_totp(db: AsyncSession, user: User, password: str | None) -> None:
        is_google_user = bool(getattr(user, "google_id", None))
        if not is_google_user:
            if not password or not password.strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Password is required to disable 2FA.",
                )
            if not verify_password(password, user.hashed_password):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid password",
                )
        user.totp_secret = None
        user.totp_enabled = False
        await db.flush()

    @staticmethod
    async def change_password(
        db: AsyncSession,
        user: User,
        current_password: str,
        new_password: str,
    ) -> None:
        if not verify_password(current_password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Current password is incorrect",
            )
        try:
            validate_password_strength(new_password)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e),
            )
        user.hashed_password = get_password_hash(new_password)
        await db.flush()
