from datetime import datetime
from pydantic import BaseModel, EmailStr, Field
from typing import List


class ServerAccessItem(BaseModel):
    server_id: str
    role: str = Field(..., pattern="^(admin|user)$")


class UserBase(BaseModel):
    email: EmailStr
    username: str = Field(..., min_length=2, max_length=100)
    phone: str | None = Field(None, min_length=10, max_length=20, pattern=r"^\+[1-9]\d{8,14}$")


class UserCreate(UserBase):
    password: str = Field(..., min_length=8)
    role_ids: List[str] = []
    server_access: List[ServerAccessItem] = []


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
    onboarding_completed: bool = True
    needs_initial_password: bool = False
    needs_initial_username: bool = False
    tenant_id: str | None = None
    company_name: str | None = None
    created_at: datetime
    roles: List[RoleBrief] = []
    server_access: List[ServerAccessItem] = []

    class Config:
        from_attributes = True


class UserListResponse(BaseModel):
    users: List[UserResponse]
    total: int
