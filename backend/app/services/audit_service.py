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
    ip_address: str | None = None,
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
        ip_address=ip_address,
        details=details,
    )
    db.add(entry)
    await db.flush()


def _logs_query(action: str | None = None, user_id: str | None = None, tenant_id: str | None = None):
    from app.models.user import User
    q = select(AuditLog).order_by(AuditLog.created_at.desc())
    if tenant_id:
        q = q.join(User, AuditLog.user_id == User.id).where(User.tenant_id == tenant_id)
    elif user_id:
        q = q.where(AuditLog.user_id == user_id)
    if action:
        q = q.where(AuditLog.action == action)
    return q


async def get_logs_count(db: AsyncSession, action: str | None = None, user_id: str | None = None, tenant_id: str | None = None) -> int:
    """Return total count of audit log entries matching the filter."""
    from sqlalchemy import func
    from app.models.user import User
    q = select(func.count()).select_from(AuditLog)
    if tenant_id:
        q = q.join(User, AuditLog.user_id == User.id).where(User.tenant_id == tenant_id)
    elif user_id:
        q = q.where(AuditLog.user_id == user_id)
    if action:
        q = q.where(AuditLog.action == action)
    r = await db.execute(q)
    return r.scalar() or 0


async def get_logs(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 100,
    action: str | None = None,
    user_id: str | None = None,
    tenant_id: str | None = None,
) -> list[AuditLog]:
    """Return audit log entries, newest first. Filter by user_id (single user) or tenant_id (all users in tenant)."""
    q = _logs_query(action=action, user_id=user_id, tenant_id=tenant_id).offset(skip).limit(limit)
    r = await db.execute(q)
    return list(r.scalars().all())


async def get_all_logs_for_export(
    db: AsyncSession,
    action: str | None = None,
    user_id: str | None = None,
    max_rows: int = 100_000,
) -> list[AuditLog]:
    """Return all audit log entries for CSV export, oldest first. Filter by user_id for admin-scoped export."""
    q = select(AuditLog).order_by(AuditLog.created_at.asc())
    if action:
        q = q.where(AuditLog.action == action)
    if user_id:
        q = q.where(AuditLog.user_id == user_id)
    q = q.limit(max_rows)
    r = await db.execute(q)
    return list(r.scalars().all())


# ─── Superadmin: all tenants with tenant/company and IP ───────────────────────

async def get_superadmin_logs(
    db: AsyncSession,
    *,
    skip: int = 0,
    limit: int = 100,
    action: str | None = None,
    tenant_id: str | None = None,
) -> list[tuple[AuditLog, str | None]]:
    """Return audit logs for superadmin with tenant company name. Joins User->Tenant."""
    from app.models.user import User
    from app.models.tenant import Tenant

    q = (
        select(AuditLog, Tenant.company_name)
        .outerjoin(User, AuditLog.user_id == User.id)
        .outerjoin(Tenant, User.tenant_id == Tenant.id)
        .order_by(AuditLog.created_at.desc())
    )
    if action:
        q = q.where(AuditLog.action == action)
    if tenant_id:
        q = q.where(User.tenant_id == tenant_id)
    q = q.offset(skip).limit(limit)
    r = await db.execute(q)
    return list(r.all())


async def get_superadmin_logs_count(
    db: AsyncSession,
    *,
    action: str | None = None,
    tenant_id: str | None = None,
) -> int:
    """Count audit logs for superadmin with optional filters."""
    from sqlalchemy import func
    from app.models.user import User

    q = select(func.count()).select_from(AuditLog)
    if action or tenant_id:
        q = q.outerjoin(User, AuditLog.user_id == User.id)
    if action:
        q = q.where(AuditLog.action == action)
    if tenant_id:
        q = q.where(User.tenant_id == tenant_id)
    r = await db.execute(q)
    return r.scalar() or 0


async def get_superadmin_logs_for_export(
    db: AsyncSession,
    *,
    action: str | None = None,
    tenant_id: str | None = None,
    max_rows: int = 100_000,
) -> list[tuple[AuditLog, str | None]]:
    """Return audit logs for superadmin CSV export, oldest first."""
    from app.models.user import User
    from app.models.tenant import Tenant

    q = (
        select(AuditLog, Tenant.company_name)
        .outerjoin(User, AuditLog.user_id == User.id)
        .outerjoin(Tenant, User.tenant_id == Tenant.id)
        .order_by(AuditLog.created_at.asc())
    )
    if action:
        q = q.where(AuditLog.action == action)
    if tenant_id:
        q = q.where(User.tenant_id == tenant_id)
    q = q.limit(max_rows)
    r = await db.execute(q)
    return list(r.all())
