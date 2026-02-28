"""History / audit log API (admin only)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.auth import get_current_user, require_superuser
from app.models import User
from app.services import audit_service

router = APIRouter(prefix="/history", tags=["history"])


def _require_admin(current_user: Annotated[User, Depends(get_current_user)]):
    if current_user.is_superuser or any(r.name == "admin" for r in (current_user.roles or [])):
        return current_user
    from fastapi import HTTPException
    raise HTTPException(status_code=403, detail="Admin access required")


@router.get("")
async def get_history(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(_require_admin)],
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    action: str | None = Query(None, description="Filter by action"),
):
    """Return audit log entries for the History page (admin only). Shows this admin's actions and actions by users in their tenant."""
    if current_user.tenant_id:
        entries = await audit_service.get_logs(db, skip=skip, limit=limit, action=action, tenant_id=str(current_user.tenant_id))
        total = await audit_service.get_logs_count(db, action=action, tenant_id=str(current_user.tenant_id))
    else:
        entries = await audit_service.get_logs(db, skip=skip, limit=limit, action=action, user_id=str(current_user.id))
        total = await audit_service.get_logs_count(db, action=action, user_id=str(current_user.id))
    return {
        "entries": [
            {
                "id": e.id,
                "created_at": e.created_at.isoformat() if e.created_at else None,
                "action": e.action,
                "resource_type": e.resource_type,
                "resource_id": e.resource_id,
                "user_id": e.user_id,
                "username": e.username,
                "ip_address": getattr(e, "ip_address", None),
                "details": e.details,
            }
            for e in entries
        ],
        "total": total,
    }
