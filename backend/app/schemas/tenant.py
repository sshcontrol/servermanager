from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.security import validate_password_strength


def _validate_password(v: str) -> str:
    validate_password_strength(v)
    return v


class SignupRequest(BaseModel):
    company_name: str = Field(..., min_length=2, max_length=255)
    full_name: str = Field(..., min_length=2, max_length=255)
    email: EmailStr
    password: str = Field(..., min_length=8)
    accept_terms: bool

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        return _validate_password(v)

class SignupResponse(BaseModel):
    message: str
    user_id: str
    tenant_id: str
    email: str

class VerifyEmailRequest(BaseModel):
    token: str

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(..., min_length=8)

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        return _validate_password(v)

class ResendVerificationRequest(BaseModel):
    email: EmailStr


class PlanResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    price: Decimal
    currency: str
    duration_days: int
    duration_label: str
    max_users: int
    max_servers: int
    is_free: bool
    is_hidden: bool = False
    sort_order: int
    stripe_price_id: Optional[str] = None

    class Config:
        from_attributes = True


class PlanCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    description: Optional[str] = None
    price: Decimal = Field(default=Decimal("0"), ge=0)
    currency: str = Field(default="USD", max_length=3)
    duration_days: int = Field(default=30, ge=1)
    duration_label: str = Field(default="1 month", max_length=50)
    max_users: int = Field(default=3, ge=1)
    max_servers: int = Field(default=5, ge=1)
    is_free: bool = False
    is_hidden: bool = False
    sort_order: int = 0
    stripe_price_id: Optional[str] = Field(None, max_length=255)


class PlanUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=100)
    description: Optional[str] = None
    price: Optional[Decimal] = Field(None, ge=0)
    currency: Optional[str] = Field(None, max_length=3)
    duration_days: Optional[int] = Field(None, ge=1)
    duration_label: Optional[str] = Field(None, max_length=50)
    max_users: Optional[int] = Field(None, ge=1)
    max_servers: Optional[int] = Field(None, ge=1)
    is_free: Optional[bool] = None
    is_hidden: Optional[bool] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None
    stripe_price_id: Optional[str] = Field(None, max_length=255)


class SubscriptionResponse(BaseModel):
    id: str
    plan: PlanResponse
    is_active: bool
    starts_at: datetime
    expires_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class TenantResponse(BaseModel):
    id: str
    company_name: str
    is_active: bool
    created_at: datetime
    owner_id: Optional[str] = None
    owner_email: Optional[str] = None
    owner_full_name: Optional[str] = None
    owner_username: Optional[str] = None
    owner_phone: Optional[str] = None
    owner_totp_enabled: Optional[bool] = None
    owner_sms_verification_enabled: Optional[bool] = None
    owner_email_verified: Optional[bool] = None
    owner_last_seen_at: Optional[datetime] = None
    plan_name: Optional[str] = None
    plan_id: Optional[str] = None
    subscription_expires_at: Optional[datetime] = None
    user_count: int = 0
    server_count: int = 0

    class Config:
        from_attributes = True


class TenantCreate(BaseModel):
    company_name: str = Field(..., min_length=2, max_length=255)
    full_name: str = Field(..., min_length=2, max_length=255)
    email: EmailStr
    password: str = Field(..., min_length=8)
    plan_id: Optional[str] = None

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        return _validate_password(v)


class TenantUpdate(BaseModel):
    company_name: Optional[str] = Field(None, min_length=2, max_length=255)
    is_active: Optional[bool] = None
    owner_email: Optional[EmailStr] = None
    owner_phone: Optional[str] = Field(None, min_length=10, max_length=20, pattern=r"^\+[1-9]\d{8,14}$")
    owner_totp_enabled: Optional[bool] = None
    owner_sms_verification_enabled: Optional[bool] = None


class TenantPlanAssign(BaseModel):
    plan_id: str


class PlanLimitsResponse(BaseModel):
    plan_name: str
    max_users: int
    max_servers: int
    current_users: int
    current_servers: int
    expires_at: Optional[datetime] = None
