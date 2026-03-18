from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import List

from app.core.security import validate_password_strength


class ServerAccessItem(BaseModel):
    server_id: str
    role: str = Field(..., pattern="^(root|user)$")  # root = Linux elevated/sudo, user = Linux regular

    @field_validator("role", mode="before")
    @classmethod
    def normalize_role(cls, v: str) -> str:
        """Accept legacy 'admin' and normalize to 'root'."""
        return "root" if v == "admin" else v


class UserBase(BaseModel):
    email: EmailStr
    username: str = Field(..., min_length=2, max_length=100)
    phone: str | None = Field(None, min_length=10, max_length=20, pattern=r"^\+[1-9]\d{8,14}$")


class UserCreate(UserBase):
    password: str = Field(..., min_length=8)
    role_ids: List[str] = []
    server_access: List[ServerAccessItem] = []

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        validate_password_strength(v)
        return v


class ProfileUpdate(BaseModel):
    """Current user can update username, email, and phone."""
    email: EmailStr | None = None
    username: str | None = Field(None, min_length=2, max_length=100)
    phone: str | None = Field(None, min_length=10, max_length=20, pattern=r"^\+[1-9]\d{8,14}$")


class PublicKeyUpload(BaseModel):
    """Upload your own SSH public key (one line, OpenSSH format)."""
    public_key: str = Field(..., min_length=100)


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    username: str | None = Field(None, min_length=2, max_length=100)
    phone: str | None = Field(None, min_length=10, max_length=20, pattern=r"^\+[1-9]\d{8,14}$")
    password: str | None = Field(None, min_length=8)

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str | None) -> str | None:
        if v is not None:
            validate_password_strength(v)
        return v
    is_active: bool | None = None
    totp_enabled: bool | None = None  # admin can set False to disable 2FA for user
    role_ids: List[str] | None = None
    server_access: List[ServerAccessItem] | None = None


class RoleBrief(BaseModel):
    id: str
    name: str

    class Config:
        from_attributes = True


class UserResponse(BaseModel):
    id: str
    email: str
    username: str
    full_name: str | None = None
    phone: str | None = None
    is_active: bool
    is_superuser: bool
    totp_enabled: bool
    email_verified: bool = True
    phone_verified: bool = False
    sms_verification_enabled: bool = False
    onboarding_completed: bool = True
    needs_initial_password: bool = False
    needs_initial_username: bool = False
    is_google_user: bool = False  # True if signed up via Google (no password to verify)
    is_tenant_owner: bool = False  # True if user owns their tenant (can edit company name)
    tenant_id: str | None = None
    company_name: str | None = None
    created_at: datetime
    roles: List[RoleBrief] = []
    server_access: List[ServerAccessItem] = []
    effective_server_access: List[ServerAccessItem] | None = None  # From direct + server groups + user groups; set by API when needed

    class Config:
        from_attributes = True


class UserListResponse(BaseModel):
    users: List[UserResponse]
    total: int
