"""SMPP callback log for recording delivery reports and other callbacks from SMPP provider."""

from sqlalchemy import Column, String, Text, DateTime
from app.database import Base
from app.models.user import generate_uuid, utcnow_naive


class SmppCallback(Base):
    """Record of an incoming SMPP callback (e.g. delivery report)."""
    __tablename__ = "smpp_callbacks"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    callback_type = Column(String(50), nullable=False, default="")  # e.g. delivery_report, mo_message
    message_id = Column(String(255), nullable=True)  # provider message ID
    status = Column(String(50), nullable=True)  # delivered, failed, etc.
    raw_payload = Column(Text, nullable=True)  # full JSON payload for debugging
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)
