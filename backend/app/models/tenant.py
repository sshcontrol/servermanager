"""Multi-tenant models: Tenant (organization), Plan, Subscription, email verification."""

from sqlalchemy import Column, String, Boolean, DateTime, Integer, Text, ForeignKey, Numeric
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.user import generate_uuid, utcnow_naive


class Plan(Base):
    __tablename__ = "plans"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    name = Column(String(100), unique=True, nullable=False)
    description = Column(Text, nullable=True)
    price = Column(Numeric(10, 2), nullable=False, default=0)
    currency = Column(String(3), nullable=False, default="USD")
    duration_days = Column(Integer, nullable=False, default=30)
    duration_label = Column(String(50), nullable=False, default="1 month")
    max_users = Column(Integer, nullable=False, default=3)
    max_servers = Column(Integer, nullable=False, default=5)
    is_free = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    is_hidden = Column(Boolean, default=False, nullable=False)
    sort_order = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)
    updated_at = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)

    subscriptions = relationship("Subscription", back_populates="plan")


class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    company_name = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)
    updated_at = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)

    owner_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    owner = relationship("User", foreign_keys=[owner_id])

    subscriptions = relationship("Subscription", back_populates="tenant", cascade="all, delete-orphan")
    users = relationship("User", back_populates="tenant", foreign_keys="User.tenant_id")
    servers = relationship("Server", back_populates="tenant")
    platform_keys = relationship("PlatformSSHKey", back_populates="tenant")
    deployment_tokens = relationship("DeploymentToken", back_populates="tenant")


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    plan_id = Column(String(36), ForeignKey("plans.id", ondelete="RESTRICT"), nullable=False, index=True)
    is_active = Column(Boolean, default=True, nullable=False)
    starts_at = Column(DateTime, nullable=False, default=utcnow_naive)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)

    tenant = relationship("Tenant", back_populates="subscriptions")
    plan = relationship("Plan", back_populates="subscriptions")


class EmailVerificationToken(Base):
    __tablename__ = "email_verification_tokens"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token = Column(String(128), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token = Column(String(128), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)


class DestructiveVerificationToken(Base):
    """4-digit code sent to admin's email for verifying destructive actions (delete server, user, group)."""
    __tablename__ = "destructive_verification_tokens"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    action = Column(String(50), nullable=False, index=True)  # delete_server, delete_user, delete_server_group, delete_user_group
    target_id = Column(String(36), nullable=False, index=True)
    code = Column(String(10), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)


class UserInvitation(Base):
    __tablename__ = "user_invitations"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    invited_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    email = Column(String(255), nullable=False)
    token = Column(String(128), unique=True, nullable=False, index=True)
    role_name = Column(String(50), nullable=False, default="user")
    accepted = Column(Boolean, default=False, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)

    tenant = relationship("Tenant")
    inviter = relationship("User", foreign_keys=[invited_by])
