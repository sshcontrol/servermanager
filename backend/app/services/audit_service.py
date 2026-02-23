"""Audit logging for history."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog


async def log(
    db: AsyncSession,
    action: str,
    *,
    resource_type: str | None = None,
    resource_id: str | None = None,
    user_id: str | None = None,
    username: str | None = None,
    details: str | None = None,
) -> None:
    """Append an audit log entry."""
    entry = AuditLog(
        id=str(uuid.uuid4()),
        created_at=datetime.now(timezone.utc),
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        user_id=user_id,
        username=username,
        details=details,
    )
    db.add(entry)
    await db.flush()


def _logs_query(action: str | None = None):
    q = select(AuditLog).order_by(AuditLog.created_at.desc())
    if action:
        q = q.where(AuditLog.action == action)
    return q


async def get_logs_count(db: AsyncSession, action: str | None = None) -> int:
    """Return total count of audit log entries matching the filter."""
    from sqlalchemy import func
    q = select(func.count()).select_from(AuditLog)
    if action:
        q = q.where(AuditLog.action == action)
    r = await db.execute(q)
    return r.scalar() or 0


async def get_logs(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 100,
    action: str | None = None,
) -> list[AuditLog]:
    """Return audit log entries, newest first."""
    q = _logs_query(action).offset(skip).limit(limit)
    r = await db.execute(q)
    return list(r.scalars().all())


async def get_all_logs_for_export(
    db: AsyncSession,
    action: str | None = None,
    max_rows: int = 100_000,
) -> list[AuditLog]:
    """Return all audit log entries for CSV export, oldest first. Capped at max_rows."""
    q = select(AuditLog).order_by(AuditLog.created_at.asc())
    if action:
        q = q.where(AuditLog.action == action)
    q = q.limit(max_rows)
    r = await db.execute(q)
    return list(r.scalars().all())
