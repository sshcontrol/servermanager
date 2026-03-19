"""Ticket support system: create, reply, list, update status."""

import logging
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from sqlalchemy.orm import selectinload

from app.models.ticket import Ticket, TicketMessage
from app.models.notification import Notification
from app.models.user import User, generate_uuid, utcnow_naive

logger = logging.getLogger(__name__)

CONTACT_EMAIL = "info@sshcontrol.com"

CATEGORIES = ["bug", "feature", "recommendation", "general", "billing", "security"]
PRIORITIES = ["low", "medium", "high", "critical"]
STATUSES = ["open", "in_progress", "resolved", "closed"]


async def create_ticket(
    db: AsyncSession,
    user_id: str,
    tenant_id: Optional[str],
    subject: str,
    category: str,
    priority: str,
    message: str,
    attachment_url: Optional[str] = None,
) -> Ticket:
    """Create a new support ticket with initial message."""
    ticket = Ticket(
        user_id=user_id,
        tenant_id=tenant_id,
        subject=subject,
        category=category if category in CATEGORIES else "general",
        priority=priority if priority in PRIORITIES else "medium",
        status="open",
    )
    db.add(ticket)
    await db.flush()

    msg = TicketMessage(
        ticket_id=ticket.id,
        user_id=user_id,
        message=message,
        is_staff_reply=False,
        attachment_url=attachment_url,
    )
    db.add(msg)
    await db.flush()
    return ticket


async def add_reply(
    db: AsyncSession,
    ticket_id: str,
    user_id: str,
    message: str,
    is_staff_reply: bool = False,
    attachment_url: Optional[str] = None,
) -> TicketMessage:
    """Add a reply to a ticket."""
    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        raise ValueError("Ticket not found")
    
    msg = TicketMessage(
        ticket_id=ticket_id,
        user_id=user_id,
        message=message,
        is_staff_reply=is_staff_reply,
        attachment_url=attachment_url,
    )
    db.add(msg)
    ticket.updated_at = utcnow_naive()
    if is_staff_reply and ticket.status == "open":
        ticket.status = "in_progress"
    await db.flush()
    return msg


async def update_ticket_status(db: AsyncSession, ticket_id: str, new_status: str) -> Ticket:
    """Update ticket status."""
    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        raise ValueError("Ticket not found")
    if new_status not in STATUSES:
        raise ValueError(f"Invalid status: {new_status}")
    ticket.status = new_status
    ticket.updated_at = utcnow_naive()
    if new_status == "closed":
        ticket.closed_at = utcnow_naive()
    await db.flush()
    return ticket


async def get_ticket_with_messages(db: AsyncSession, ticket_id: str) -> Optional[Ticket]:
    """Get a ticket with all messages loaded."""
    result = await db.execute(
        select(Ticket)
        .options(selectinload(Ticket.messages), selectinload(Ticket.user))
        .where(Ticket.id == ticket_id)
    )
    return result.scalar_one_or_none()


async def list_user_tickets(
    db: AsyncSession, user_id: str, skip: int = 0, limit: int = 50
) -> tuple[list[Ticket], int]:
    """List tickets for a specific user."""
    count_q = select(func.count(Ticket.id)).where(Ticket.user_id == user_id)
    total = (await db.execute(count_q)).scalar() or 0
    
    q = (
        select(Ticket)
        .options(selectinload(Ticket.user))
        .where(Ticket.user_id == user_id)
        .order_by(desc(Ticket.created_at))
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(q)
    return list(result.scalars().all()), total


async def list_all_tickets(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 50,
    status_filter: Optional[str] = None,
    category_filter: Optional[str] = None,
) -> tuple[list[Ticket], int]:
    """List all tickets (for superadmin)."""
    base = select(Ticket)
    count_base = select(func.count(Ticket.id))
    
    if status_filter:
        base = base.where(Ticket.status == status_filter)
        count_base = count_base.where(Ticket.status == status_filter)
    if category_filter:
        base = base.where(Ticket.category == category_filter)
        count_base = count_base.where(Ticket.category == category_filter)
    
    total = (await db.execute(count_base)).scalar() or 0
    q = base.options(selectinload(Ticket.user)).order_by(desc(Ticket.created_at)).offset(skip).limit(limit)
    result = await db.execute(q)
    return list(result.scalars().all()), total


def format_ticket_dict(ticket: Ticket) -> dict:
    """Format ticket for API response."""
    return {
        "id": ticket.id,
        "ticket_number": ticket.ticket_number,
        "subject": ticket.subject,
        "category": ticket.category,
        "priority": ticket.priority,
        "status": ticket.status,
        "user_id": ticket.user_id,
        "user_name": (ticket.user.full_name or ticket.user.username) if ticket.user else None,
        "user_email": ticket.user.email if ticket.user else None,
        "tenant_id": ticket.tenant_id,
        "created_at": ticket.created_at.isoformat() if ticket.created_at else None,
        "updated_at": ticket.updated_at.isoformat() if ticket.updated_at else None,
        "closed_at": ticket.closed_at.isoformat() if ticket.closed_at else None,
    }


def format_message_dict(msg: TicketMessage) -> dict:
    """Format ticket message for API response."""
    return {
        "id": msg.id,
        "ticket_id": msg.ticket_id,
        "user_id": msg.user_id,
        "user_name": (msg.user.full_name or msg.user.username) if msg.user else "System",
        "message": msg.message,
        "is_staff_reply": msg.is_staff_reply,
        "attachment_url": msg.attachment_url,
        "created_at": msg.created_at.isoformat() if msg.created_at else None,
    }
