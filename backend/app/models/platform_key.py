"""Per-tenant platform SSH key pair for server access. Admin can regenerate and download as PEM/PPK."""

from sqlalchemy import Column, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.user import generate_uuid, utcnow_naive


class PlatformSSHKey(Base):
    __tablename__ = "platform_ssh_key"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True)
    private_key_pem = Column(Text, nullable=False)
    public_key = Column(Text, nullable=False)
    fingerprint = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)

    tenant = relationship("Tenant", back_populates="platform_keys")
