"""User notifications: list, mark read."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.core.auth import get_current_user
from app.models import User, Notification

router = APIRouter()


@router.get("/me")
async def list_my_notifications(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: int = Query(50, ge=1, le=100),
    unread_only: bool = False,
):
    """List current user's notifications."""
    q = (
        select(Notification)
        .options(selectinload(Notification.sender))
        .where(Notification.recipient_id == str(current_user.id))
    )
    if unread_only:
        q = q.where(Notification.read_at.is_(None))
    q = q.order_by(Notification.created_at.desc()).limit(limit)
    result = await db.execute(q)
    items = result.scalars().all()

    count_result = await db.execute(
        select(func.count(Notification.id)).where(
            Notification.recipient_id == str(current_user.id),
            Notification.read_at.is_(None),
        )
    )
    unread_count = count_result.scalar() or 0

    return {
        "notifications": [
            {
                "id": n.id,
                "subject": n.subject,
                "message": n.message,
                "notification_type": n.notification_type,
                "created_at": n.created_at.isoformat() if n.created_at else None,
                "read_at": n.read_at.isoformat() if n.read_at else None,
                "sender_name": n.sender.full_name or n.sender.username if n.sender else "Platform",
            }
            for n in items
        ],
        "unread_count": unread_count,
    }


@router.patch("/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Mark a notification as read."""
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.recipient_id == str(current_user.id),
        )
    )
    n = result.scalar_one_or_none()
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found")
    from app.models.user import utcnow_naive
    n.read_at = utcnow_naive()
    await db.flush()
    return {"message": "Marked as read"}


@router.delete("/{notification_id}")
async def delete_notification(
    notification_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Delete a notification (recipient can only delete their own)."""
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.recipient_id == str(current_user.id),
        )
    )
    n = result.scalar_one_or_none()
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found")
    await db.delete(n)
    await db.flush()
    return {"message": "Deleted"}


@router.post("/read-all")
async def mark_all_read(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Mark all notifications as read."""
    from app.models.user import utcnow_naive
    now = utcnow_naive()
    await db.execute(
        update(Notification)
        .where(
            Notification.recipient_id == str(current_user.id),
            Notification.read_at.is_(None),
        )
        .values(read_at=now)
    )
    await db.flush()
    return {"message": "All marked as read"}
