"""Support ticket system for users to submit and track issues."""

from sqlalchemy import Column, String, Integer, Text, Boolean, DateTime, ForeignKey, Sequence
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.user import generate_uuid, utcnow_naive

ticket_number_seq = Sequence("ticket_number_seq")


class Ticket(Base):
    """A support ticket submitted by a user."""
    __tablename__ = "tickets"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    ticket_number = Column(Integer, ticket_number_seq, unique=True, nullable=False, server_default=ticket_number_seq.next_value())
    tenant_id = Column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    subject = Column(String(255), nullable=False)
    category = Column(String(50), nullable=False, default="general")
    priority = Column(String(20), nullable=False, default="medium")
    status = Column(String(20), nullable=False, default="open")
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)
    updated_at = Column(DateTime, nullable=True, onupdate=utcnow_naive)
    closed_at = Column(DateTime, nullable=True)

    messages = relationship("TicketMessage", back_populates="ticket", cascade="all, delete-orphan", order_by="TicketMessage.created_at")
    user = relationship("User", foreign_keys=[user_id])
    tenant = relationship("Tenant", foreign_keys=[tenant_id])


class TicketMessage(Base):
    """A message within a support ticket thread."""
    __tablename__ = "ticket_messages"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    ticket_id = Column(String(36), ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    message = Column(Text, nullable=False)
    is_staff_reply = Column(Boolean, default=False, nullable=False)
    attachment_url = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)

    ticket = relationship("Ticket", back_populates="messages")
    user = relationship("User", foreign_keys=[user_id])
