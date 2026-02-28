"""Audit log for history: server created/deleted, access granted/revoked, user actions."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Text, DateTime

from app.database import Base


def generate_uuid():
    return str(uuid.uuid4())


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    action = Column(String(80), nullable=False, index=True)  # server_registered, server_deleted, access_granted, etc.
    resource_type = Column(String(40), nullable=True, index=True)  # server, user
    resource_id = Column(String(36), nullable=True, index=True)
    user_id = Column(String(36), nullable=True, index=True)  # who performed the action (if applicable)
    username = Column(String(255), nullable=True)  # denormalized for display
    ip_address = Column(String(45), nullable=True)  # client IP when action was performed
    details = Column(Text, nullable=True)  # JSON or free text
