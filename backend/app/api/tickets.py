"""Ticket support system API endpoints."""

import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field

from app.database import get_db
from app.core.auth import get_current_user
from app.models import User, Notification
from app.models.user import generate_uuid, utcnow_naive
from app.services import ticket_service, email_service

logger = logging.getLogger(__name__)

router = APIRouter()


class CreateTicketRequest(BaseModel):
    subject: str = Field(..., min_length=3, max_length=255)
    category: str = Field("general", max_length=50)
    priority: str = Field("medium", max_length=20)
    message: str = Field(..., min_length=10, max_length=10000)


class ReplyRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=10000)


class UpdateStatusRequest(BaseModel):
    status: str = Field(..., max_length=20)


# ─── User endpoints ──────────────────────────────────────────────────────────

@router.post("")
async def create_ticket(
    data: CreateTicketRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Create a new support ticket."""
    ticket = await ticket_service.create_ticket(
        db,
        user_id=str(current_user.id),
        tenant_id=current_user.tenant_id,
        subject=data.subject,
        category=data.category,
        priority=data.priority,
        message=data.message,
    )

    # Send confirmation email to user
    user_name = current_user.full_name or current_user.username or "User"
    user_email = current_user.email
    if user_email:
        html = (
            '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:30px;">'
            '<h2 style="color:#2dd4bf;">Support Ticket Created</h2>'
            f'<p>Hi {user_name},</p>'
            f'<p>Your support ticket <strong>#{ticket.ticket_number}</strong> has been created.</p>'
            f'<p><strong>Subject:</strong> {data.subject}</p>'
            f'<p><strong>Category:</strong> {data.category}</p>'
            f'<p><strong>Priority:</strong> {data.priority}</p>'
            '<p>We will review your ticket and get back to you as soon as possible.</p>'
            '<p>Thank you for contacting SSHCONTROL support.</p>'
            '</div>'
        )
        await email_service._send_email(db, user_email, f"Ticket #{ticket.ticket_number} Created - {data.subject}", html)

    # Send notification email to support
    support_html = (
        '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:30px;">'
        '<h2 style="color:#2dd4bf;">New Support Ticket</h2>'
        f'<p><strong>Ticket #:</strong> {ticket.ticket_number}</p>'
        f'<p><strong>From:</strong> {user_name} ({user_email})</p>'
        f'<p><strong>Subject:</strong> {data.subject}</p>'
        f'<p><strong>Category:</strong> {data.category}</p>'
        f'<p><strong>Priority:</strong> {data.priority}</p>'
        '<hr style="border:none;border-top:1px solid #334155;margin:16px 0;">'
        f'<div style="white-space:pre-wrap;line-height:1.7;">{data.message}</div>'
        '</div>'
    )
    await email_service._send_email(db, ticket_service.CONTACT_EMAIL, f"[Ticket #{ticket.ticket_number}] {data.subject}", support_html)

    # In-app notification to user
    n = Notification(
        id=generate_uuid(),
        recipient_id=str(current_user.id),
        sender_id=None,
        subject=f"Ticket #{ticket.ticket_number} created",
        message=f"Your support ticket \"{data.subject}\" has been submitted. We'll respond shortly.",
        notification_type="system",
    )
    db.add(n)
    await db.flush()

    return {
        "message": f"Ticket #{ticket.ticket_number} created successfully.",
        "ticket": ticket_service.format_ticket_dict(ticket),
    }


@router.get("")
async def list_my_tickets(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    skip: int = 0,
    limit: int = 50,
):
    """List current user's tickets."""
    tickets, total = await ticket_service.list_user_tickets(db, str(current_user.id), skip, limit)
    return {
        "tickets": [ticket_service.format_ticket_dict(t) for t in tickets],
        "total": total,
    }


@router.get("/admin/all")
async def list_all_tickets(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    skip: int = 0,
    limit: int = 50,
    status: Optional[str] = None,
    category: Optional[str] = None,
):
    """List all tickets (superadmin only)."""
    if not current_user.is_superuser or current_user.tenant_id:
        raise HTTPException(status_code=403, detail="Superadmin access required")
    tickets, total = await ticket_service.list_all_tickets(db, skip, limit, status, category)
    return {
        "tickets": [ticket_service.format_ticket_dict(t) for t in tickets],
        "total": total,
    }


@router.get("/{ticket_id}")
async def get_ticket(
    ticket_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Get ticket details with messages."""
    ticket = await ticket_service.get_ticket_with_messages(db, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    is_superadmin = current_user.is_superuser and not current_user.tenant_id
    if not is_superadmin and str(ticket.user_id) != str(current_user.id):
        raise HTTPException(status_code=403, detail="Access denied")
    
    from sqlalchemy.orm import selectinload
    from sqlalchemy import select
    from app.models.ticket import TicketMessage
    msg_result = await db.execute(
        select(TicketMessage)
        .options(selectinload(TicketMessage.user))
        .where(TicketMessage.ticket_id == ticket_id)
        .order_by(TicketMessage.created_at)
    )
    messages = msg_result.scalars().all()
    
    return {
        "ticket": ticket_service.format_ticket_dict(ticket),
        "messages": [ticket_service.format_message_dict(m) for m in messages],
    }


@router.post("/{ticket_id}/reply")
async def reply_to_ticket(
    ticket_id: str,
    data: ReplyRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Reply to a ticket."""
    ticket = await ticket_service.get_ticket_with_messages(db, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    
    is_superadmin = current_user.is_superuser and not current_user.tenant_id
    if not is_superadmin and str(ticket.user_id) != str(current_user.id):
        raise HTTPException(status_code=403, detail="Access denied")
    
    msg = await ticket_service.add_reply(
        db,
        ticket_id=ticket_id,
        user_id=str(current_user.id),
        message=data.message,
        is_staff_reply=is_superadmin,
    )

    # Notify the other party
    if is_superadmin:
        # Staff replied — notify the ticket owner
        n = Notification(
            id=generate_uuid(),
            recipient_id=ticket.user_id,
            sender_id=str(current_user.id),
            subject=f"Reply on Ticket #{ticket.ticket_number}",
            message=f"Support has replied to your ticket \"{ticket.subject}\".",
            notification_type="system",
        )
        db.add(n)
        
        # Email the ticket owner
        if ticket.user and ticket.user.email:
            owner_name = ticket.user.full_name or ticket.user.username or "User"
            html = (
                '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:30px;">'
                '<h2 style="color:#2dd4bf;">New Reply on Your Ticket</h2>'
                f'<p>Hi {owner_name},</p>'
                f'<p>Support has replied to your ticket <strong>#{ticket.ticket_number}</strong> — "{ticket.subject}".</p>'
                '<hr style="border:none;border-top:1px solid #334155;margin:16px 0;">'
                f'<div style="white-space:pre-wrap;line-height:1.7;">{data.message}</div>'
                '<hr style="border:none;border-top:1px solid #334155;margin:16px 0;">'
                '<p>You can view and reply in your SSHCONTROL dashboard under Support.</p>'
                '</div>'
            )
            await email_service._send_email(db, ticket.user.email, f"[Ticket #{ticket.ticket_number}] New Reply - {ticket.subject}", html)
    else:
        # User replied — email to support
        user_name = current_user.full_name or current_user.username or "User"
        html = (
            '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:30px;">'
            '<h2 style="color:#2dd4bf;">New Reply on Ticket</h2>'
            f'<p><strong>Ticket #:</strong> {ticket.ticket_number}</p>'
            f'<p><strong>From:</strong> {user_name} ({current_user.email})</p>'
            f'<p><strong>Subject:</strong> {ticket.subject}</p>'
            '<hr style="border:none;border-top:1px solid #334155;margin:16px 0;">'
            f'<div style="white-space:pre-wrap;line-height:1.7;">{data.message}</div>'
            '</div>'
        )
        await email_service._send_email(db, ticket_service.CONTACT_EMAIL, f"[Ticket #{ticket.ticket_number}] Reply from {user_name}", html)

    await db.flush()
    return {"message": "Reply sent", "reply": ticket_service.format_message_dict(msg)}


# ─── Superadmin endpoints ────────────────────────────────────────────────────

@router.patch("/{ticket_id}/status")
async def update_ticket_status(
    ticket_id: str,
    data: UpdateStatusRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Update ticket status (superadmin only)."""
    if not current_user.is_superuser or current_user.tenant_id:
        raise HTTPException(status_code=403, detail="Superadmin access required")
    try:
        ticket = await ticket_service.update_ticket_status(db, ticket_id, data.status)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    # Notify ticket owner of status change
    n = Notification(
        id=generate_uuid(),
        recipient_id=ticket.user_id,
        sender_id=str(current_user.id),
        subject=f"Ticket #{ticket.ticket_number} — {data.status.replace('_', ' ').title()}",
        message=f"Your ticket \"{ticket.subject}\" status has been updated to: {data.status.replace('_', ' ').title()}.",
        notification_type="system",
    )
    db.add(n)

    # Email the ticket owner about status change
    from sqlalchemy import select as _sel
    user_result = await db.execute(_sel(User).where(User.id == ticket.user_id))
    owner = user_result.scalar_one_or_none()
    if owner and owner.email:
        owner_name = owner.full_name or owner.username or "User"
        status_label = data.status.replace("_", " ").title()
        html = (
            '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:30px;">'
            '<h2 style="color:#2dd4bf;">Ticket Status Updated</h2>'
            f'<p>Hi {owner_name},</p>'
            f'<p>Your ticket <strong>#{ticket.ticket_number}</strong> — "{ticket.subject}" has been updated.</p>'
            f'<p><strong>New Status:</strong> {status_label}</p>'
            '<p>You can view details in your SSHCONTROL dashboard under Support.</p>'
            '</div>'
        )
        await email_service._send_email(db, owner.email, f"[Ticket #{ticket.ticket_number}] Status: {status_label}", html)

    await db.flush()
    return {"message": f"Status updated to {data.status}", "ticket": ticket_service.format_ticket_dict(ticket)}
