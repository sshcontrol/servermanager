"""User notifications from superadmin or system."""

from sqlalchemy import Column, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.user import generate_uuid, utcnow_naive


class Notification(Base):
    """Message sent to a user (from superadmin or system)."""
    __tablename__ = "notifications"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    recipient_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    sender_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    subject = Column(String(255), nullable=True)
    message = Column(Text, nullable=False)
    notification_type = Column(String(50), nullable=False, default="announcement")  # announcement, payment_reminder, system
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)
    read_at = Column(DateTime, nullable=True)

    recipient = relationship("User", foreign_keys=[recipient_id])
    sender = relationship("User", foreign_keys=[sender_id])
