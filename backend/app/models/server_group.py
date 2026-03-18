"""Server groups: group of servers; users can be assigned to a group with a role (applies to all servers in group)."""

from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Table, UniqueConstraint
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.utils import generate_uuid, utcnow_naive


class ServerGroup(Base):
    __tablename__ = "server_groups"
    __table_args__ = (UniqueConstraint("tenant_id", "name", name="uq_server_groups_tenant_name"),)

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)
    updated_at = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)

    tenant = relationship("Tenant", backref="server_groups")
    # Servers in this group (many-to-many via server_group_servers table)
    servers = relationship(
        "Server",
        secondary="server_group_servers",
        back_populates="server_groups",
    )
    # Users with access to all servers in this group (user_id -> role)
    access = relationship(
        "ServerGroupAccess",
        back_populates="server_group",
        cascade="all, delete-orphan",
    )


# Association: server_group <-> servers
server_group_servers = Table(
    "server_group_servers",
    Base.metadata,
    Column("server_group_id", String(36), ForeignKey("server_groups.id", ondelete="CASCADE"), primary_key=True),
    Column("server_id", String(36), ForeignKey("servers.id", ondelete="CASCADE"), primary_key=True),
)


class ServerGroupAccess(Base):
    """User has this role on all servers in the server group."""
    __tablename__ = "server_group_access"

    server_group_id = Column(String(36), ForeignKey("server_groups.id", ondelete="CASCADE"), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role = Column(String(20), nullable=False)  # root | user (Linux user type on server)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)

    server_group = relationship("ServerGroup", back_populates="access")
    user = relationship("User", back_populates="server_group_accesses")
