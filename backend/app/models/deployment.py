"""Per-tenant deployment token for server registration. Used in deploy script."""

from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.user import generate_uuid


class DeploymentToken(Base):
    __tablename__ = "deployment_token"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True)
    token = Column(String(64), nullable=False, unique=True, index=True)
    updated_at = Column(DateTime, nullable=True)

    tenant = relationship("Tenant", back_populates="deployment_tokens")
