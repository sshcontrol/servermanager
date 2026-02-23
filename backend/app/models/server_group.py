"""Server groups: group of servers; users can be assigned to a group with a role (applies to all servers in group)."""

from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Table
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.user import utcnow_naive
import uuid


def generate_uuid():
    return str(uuid.uuid4())


class ServerGroup(Base):
    __tablename__ = "server_groups"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    name = Column(String(255), nullable=False, unique=True, index=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)
    updated_at = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)

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
    role = Column(String(20), nullable=False)  # admin | user
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)

    server_group = relationship("ServerGroup", back_populates="access")
    user = relationship("User", back_populates="server_group_accesses")
