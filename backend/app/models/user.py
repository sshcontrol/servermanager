from datetime import datetime, timezone
from sqlalchemy import Column, String, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base
import uuid


def generate_uuid():
    return str(uuid.uuid4())


def utcnow_naive():
    """Naive UTC datetime compatible with TIMESTAMP WITHOUT TIME ZONE columns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    full_name = Column(String(255), nullable=True)
    phone = Column(String(20), nullable=True)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    is_superuser = Column(Boolean, default=False, nullable=False)
    email_verified = Column(Boolean, default=False, nullable=False)
    phone_verified = Column(Boolean, default=False, nullable=False)
    onboarding_completed = Column(Boolean, default=False, nullable=False)
    needs_initial_password = Column(Boolean, default=False, nullable=False)
    needs_initial_username = Column(Boolean, default=False, nullable=False)

    # TOTP 2FA
    totp_secret = Column(String(32), nullable=True)
    totp_enabled = Column(Boolean, default=False, nullable=False)

    created_at = Column(DateTime, default=utcnow_naive, nullable=False)
    updated_at = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)
    last_seen_at = Column(DateTime, nullable=True)

    tenant = relationship("Tenant", back_populates="users", foreign_keys=[tenant_id])
    roles = relationship("Role", secondary="user_roles", back_populates="users")
    ssh_keys = relationship("UserSSHKey", back_populates="user", cascade="all, delete-orphan")
    server_accesses = relationship("ServerAccess", back_populates="user", cascade="all, delete-orphan")
    server_group_accesses = relationship(
        "ServerGroupAccess",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    user_groups = relationship(
        "UserGroup",
        secondary="user_group_members",
        back_populates="members",
    )
