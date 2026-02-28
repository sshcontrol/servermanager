from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.security import validate_password_strength


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    requires_totp: bool = False


class TokenPayload(BaseModel):
    sub: str
    type: str
    exp: int | None = None


class LoginRequest(BaseModel):
    username: str | None = None
    password: str | None = None
    totp_code: str | None = None
    sms_code: str | None = None  # When sms_verification_enabled, required after first step
    pending_token: str | None = None  # From requires_sms response; send with sms_code
    recaptcha_token: str | None = None


class VerifyLoginSmsRequest(BaseModel):
    pending_token: str
    sms_code: str = Field(..., min_length=4, max_length=8)


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_id: str
    username: str
    email: str


class LoginSmsPendingResponse(BaseModel):
    """Returned when user has SMS verification enabled; complete login via verify-login-sms."""
    requires_sms: bool = True
    pending_token: str


class RefreshRequest(BaseModel):
    refresh_token: str


class TOTPSetupResponse(BaseModel):
    secret: str
    provisioning_uri: str
    qr_uri: str  # same as provisioning_uri for frontend to render QR


class TOTPVerifyRequest(BaseModel):
    code: str


class TOTPDisableRequest(BaseModel):
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        validate_password_strength(v)
        return v


class SetInitialPasswordRequest(BaseModel):
    """Set password and username for invited users who have needs_initial_password=True."""
    username: str = Field(..., min_length=2, max_length=100)
    new_password: str = Field(..., min_length=8)

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        validate_password_strength(v)
        return v


class SetInitialUsernameRequest(BaseModel):
    """Set username for admin signup users who have needs_initial_username=True."""
    username: str = Field(..., min_length=2, max_length=100)


class RequestPhoneVerificationRequest(BaseModel):
    """Request SMS verification code when adding/updating phone."""
    phone: str = Field(..., min_length=10, max_length=20, pattern=r"^\+[1-9]\d{8,14}$")


class VerifyPhoneRequest(BaseModel):
    """Verify phone with code from SMS. Sets phone and phone_verified=True."""
    phone: str = Field(..., min_length=10, max_length=20, pattern=r"^\+[1-9]\d{8,14}$")
    code: str = Field(..., min_length=4, max_length=8)


class SmsVerificationToggleRequest(BaseModel):
    """Enable or disable SMS verification (like 2FA). Password required when disabling."""
    enabled: bool
    password: str | None = None  # Required when disabling


class RequestDestructiveVerificationRequest(BaseModel):
    """Request a verification code for a destructive action (delete server, user, group, refund, recharge)."""
    action: str = Field(
        ...,
        pattern="^(delete_server|delete_user|delete_server_group|delete_user_group|refund_transaction|recharge_transaction)$",
    )
    target_id: str = Field(..., min_length=1, max_length=36)
    target_name: str = Field(..., min_length=1, max_length=255)
    channel: str = Field("email", pattern="^(email|sms)$")  # email or sms


class RequestAccountClosureRequest(BaseModel):
    """Request account closure. Requires password (except Google users); 2FA and SMS if enabled."""
    password: str | None = Field(None)
    totp_code: str | None = None
    sms_code: str | None = None
    pending_sms_token: str | None = None  # From requires_sms response; send with sms_code


class VerifyDestructiveActionRequest(BaseModel):
    """Verify destructive action via email code, TOTP, or SMS. Returns short-lived token for the delete request.
    For refund_transaction and recharge_transaction, password is required."""
    verification_type: str = Field(..., pattern="^(email|totp|sms)$")
    code: str = Field(..., min_length=4, max_length=8)
    action: str = Field(
        ...,
        pattern="^(delete_server|delete_user|delete_server_group|delete_user_group|refund_transaction|recharge_transaction)$",
    )
    target_id: str = Field(..., min_length=1, max_length=36)
    password: str | None = Field(None, description="Required for refund_transaction and recharge_transaction")
