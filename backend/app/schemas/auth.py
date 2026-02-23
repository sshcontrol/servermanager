from pydantic import BaseModel, EmailStr, Field


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
    username: str
    password: str
    totp_code: str | None = None


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_id: str
    username: str
    email: str


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


class SetInitialPasswordRequest(BaseModel):
    """Set password and username for invited users who have needs_initial_password=True."""
    username: str = Field(..., min_length=2, max_length=100)
    new_password: str = Field(..., min_length=8)


class SetInitialUsernameRequest(BaseModel):
    """Set username for admin signup users who have needs_initial_username=True."""
    username: str = Field(..., min_length=2, max_length=100)


class RequestDestructiveVerificationRequest(BaseModel):
    """Request a verification code for a destructive action (delete server, user, group)."""
    action: str = Field(..., pattern="^(delete_server|delete_user|delete_server_group|delete_user_group)$")
    target_id: str = Field(..., min_length=1, max_length=36)
    target_name: str = Field(..., min_length=1, max_length=255)


class VerifyDestructiveActionRequest(BaseModel):
    """Verify destructive action via email code or TOTP. Returns short-lived token for the delete request."""
    verification_type: str = Field(..., pattern="^(email|totp)$")
    code: str = Field(..., min_length=4, max_length=8)
    action: str = Field(..., pattern="^(delete_server|delete_user|delete_server_group|delete_user_group)$")
    target_id: str = Field(..., min_length=1, max_length=36)
