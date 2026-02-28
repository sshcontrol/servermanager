from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
import pyotp
from app.config import get_settings

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


PASSWORD_MIN_LENGTH = 8
PASSWORD_REQUIRE_UPPERCASE = True
PASSWORD_REQUIRE_SYMBOL = True
# Symbols: common punctuation and special chars
PASSWORD_SYMBOLS = "!@#$%^&*()_+-=[]{}|;:'\",.<>?/~`"


def validate_password_strength(password: str) -> None:
    """Validate password meets requirements. Raises ValueError with message if not."""
    if len(password) < PASSWORD_MIN_LENGTH:
        raise ValueError("Password must be at least 8 characters")
    if PASSWORD_REQUIRE_UPPERCASE and not any(c.isupper() for c in password):
        raise ValueError("Password must contain at least one uppercase letter")
    if PASSWORD_REQUIRE_SYMBOL and not any(c in PASSWORD_SYMBOLS for c in password):
        raise ValueError("Password must contain at least one symbol (e.g. !@#$%^&*)")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(subject: str | Any, extra_claims: Optional[dict] = None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_access_expire_minutes)
    to_encode = {"exp": int(expire.timestamp()), "sub": str(subject), "type": "access"}
    if extra_claims:
        to_encode.update(extra_claims)
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.jwt_algorithm)


def create_refresh_token(subject: str | Any) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.jwt_refresh_expire_days)
    to_encode = {"exp": int(expire.timestamp()), "sub": str(subject), "type": "refresh"}
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.jwt_algorithm)


def create_destructive_verification_token(user_id: str, action: str, target_id: str) -> str:
    """Short-lived token (2 min) for verifying destructive actions. Pass in X-Destructive-Verification header."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=2)
    to_encode = {
        "exp": int(expire.timestamp()),
        "sub": str(user_id),
        "type": "destructive_verify",
        "action": action,
        "target_id": target_id,
    }
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.jwt_algorithm)


def create_login_sms_pending_token(user_id: str, token_id: str) -> str:
    """Short-lived token (5 min) for login SMS verification step."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=5)
    to_encode = {
        "exp": int(expire.timestamp()),
        "sub": str(user_id),
        "type": "login_sms_pending",
        "jti": token_id,
    }
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.jwt_algorithm)


def create_account_closure_sms_pending_token(user_id: str, token_id: str) -> str:
    """Short-lived token (5 min) for account closure SMS verification step."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=5)
    to_encode = {
        "exp": int(expire.timestamp()),
        "sub": str(user_id),
        "type": "account_closure_sms_pending",
        "jti": token_id,
    }
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
        return payload
    except JWTError:
        return None


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def get_totp_uri(secret: str, account_name: str) -> str:
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(
        name=account_name,
        issuer_name=settings.totp_issuer,
    )


def verify_totp(secret: str, token: str) -> bool:
    totp = pyotp.TOTP(secret)
    return totp.verify(token, valid_window=1)
