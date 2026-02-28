"""User groups: group of users; a user group can be assigned to a server (all members get that role on the server)."""

from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Table, UniqueConstraint
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.utils import generate_uuid, utcnow_naive


class UserGroup(Base):
    __tablename__ = "user_groups"
    __table_args__ = (UniqueConstraint("tenant_id", "name", name="uq_user_groups_tenant_name"),)

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)
    updated_at = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)

    tenant = relationship("Tenant", backref="user_groups")
    members = relationship(
        "User",
        secondary="user_group_members",
        back_populates="user_groups",
    )
    server_accesses = relationship(
        "ServerUserGroupAccess",
        back_populates="user_group",
        cascade="all, delete-orphan",
    )


user_group_members = Table(
    "user_group_members",
    Base.metadata,
    Column("user_group_id", String(36), ForeignKey("user_groups.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
)


class ServerUserGroupAccess(Base):
    """User group has this role on the server; all members get access."""
    __tablename__ = "server_user_group_access"

    server_id = Column(String(36), ForeignKey("servers.id", ondelete="CASCADE"), primary_key=True)
    user_group_id = Column(String(36), ForeignKey("user_groups.id", ondelete="CASCADE"), primary_key=True)
    role = Column(String(20), nullable=False)  # admin | user
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)

    server = relationship("Server", back_populates="user_group_accesses")
    user_group = relationship("UserGroup", back_populates="server_accesses")
