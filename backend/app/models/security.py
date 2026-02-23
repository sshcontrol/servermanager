"""Security: IP whitelist settings and entries (per-tenant)."""
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.user import utcnow_naive
import uuid


def generate_uuid():
    return str(uuid.uuid4())


class IpWhitelistSettings(Base):
    """Per-tenant row: whether IP whitelist is enabled for this tenant."""
    __tablename__ = "ip_whitelist_settings"

    id = Column(String(36), primary_key=True, default="1")
    tenant_id = Column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True)
    enabled = Column(Boolean, default=False, nullable=False)
    updated_at = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)


class IpWhitelistEntry(Base):
    """One IP (or CIDR later) allowed for scope: all users or a specific user, scoped to tenant."""
    __tablename__ = "ip_whitelist_entries"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True)
    ip_address = Column(String(45), nullable=False, index=True)
    scope = Column(String(20), nullable=False)  # 'all' | 'user'
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)

    user = relationship("User", foreign_keys=[user_id])
