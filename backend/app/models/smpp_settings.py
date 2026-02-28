"""SMPP (SMS) integration settings for platform-wide SMS via SMPP."""

from sqlalchemy import Column, String, Boolean, DateTime
from app.database import Base
from app.models.user import utcnow_naive


class SmppSettings(Base):
    """Singleton row (id='1') holding SMPP connection credentials."""
    __tablename__ = "smpp_settings"

    id = Column(String(36), primary_key=True, default="1")
    link = Column(String(500), nullable=False, default="")  # SMPP gateway URL
    username = Column(String(255), nullable=False, default="")
    password = Column(String(255), nullable=False, default="")
    sender_name = Column(String(50), nullable=False, default="SSHCONTROL")
    enabled = Column(Boolean, nullable=False, default=False)
    updated_at = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)
