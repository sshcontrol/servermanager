from sqlalchemy import Column, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.user import utcnow_naive
import uuid


def generate_uuid():
    return str(uuid.uuid4())


class Server(Base):
    __tablename__ = "servers"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True)
    hostname = Column(String(255), nullable=False, index=True)
    friendly_name = Column(String(255), nullable=True)
    ip_address = Column(String(45), nullable=True)
    description = Column(Text, nullable=True)
    status = Column(String(20), default="active", nullable=False)
    sync_requested_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)
    updated_at = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)

    tenant = relationship("Tenant", back_populates="servers")

    accesses = relationship("ServerAccess", back_populates="server", cascade="all, delete-orphan")
    server_groups = relationship(
        "ServerGroup",
        secondary="server_group_servers",
        back_populates="servers",
    )
    user_group_accesses = relationship(
        "ServerUserGroupAccess",
        back_populates="server",
        cascade="all, delete-orphan",
    )


class ServerAccess(Base):
    __tablename__ = "server_access"

    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    server_id = Column(String(36), ForeignKey("servers.id", ondelete="CASCADE"), primary_key=True)
    role = Column(String(20), nullable=False)  # admin | user
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)

    server = relationship("Server", back_populates="accesses")
    user = relationship("User", back_populates="server_accesses")


class ServerSessionReport(Base):
    """Latest report from a server: which Linux usernames have an active SSH session. Updated by cron on the server."""
    __tablename__ = "server_session_reports"

    server_id = Column(String(36), ForeignKey("servers.id", ondelete="CASCADE"), primary_key=True)
    reported_at = Column(DateTime, nullable=False)
    usernames = Column(Text, nullable=False)  # JSON array of strings, e.g. ["aram", "nova"]
