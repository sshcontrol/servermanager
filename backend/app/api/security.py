"""Security: IP whitelist settings and entries (tenant-scoped, admin only)."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services import security_service
from app.core.auth import get_current_user, require_superuser
from app.models import User

router = APIRouter(prefix="/security", tags=["security"])


class WhitelistSettingsResponse(BaseModel):
    enabled: bool


class WhitelistSettingsUpdate(BaseModel):
    enabled: bool


class WhitelistEntryCreate(BaseModel):
    ip_address: str
    scope: str  # 'all' | 'user'
    user_id: str | None = None


class WhitelistEntryUpdate(BaseModel):
    ip_address: str | None = None
    scope: str | None = None
    user_id: str | None = None


class WhitelistEntryItem(BaseModel):
    id: str
    ip_address: str
    scope: str
    user_id: str | None
    username: str | None


@router.get("/whitelist-ip/settings", response_model=WhitelistSettingsResponse)
async def get_whitelist_settings(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    enabled = await security_service.get_whitelist_enabled(db, tenant_id=current_user.tenant_id)
    return WhitelistSettingsResponse(enabled=enabled)


@router.patch("/whitelist-ip/settings", response_model=WhitelistSettingsResponse)
async def update_whitelist_settings(
    body: WhitelistSettingsUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    enabled = await security_service.set_whitelist_enabled(db, body.enabled, tenant_id=current_user.tenant_id)
    return WhitelistSettingsResponse(enabled=enabled)


@router.get("/whitelist-ip/entries")
async def list_whitelist_entries(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    return await security_service.list_whitelist_entries(db, tenant_id=current_user.tenant_id)


@router.post("/whitelist-ip/entries")
async def create_whitelist_entry(
    body: WhitelistEntryCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    ip = (body.ip_address or "").strip()
    if not ip:
        raise HTTPException(status_code=400, detail="IP address is required")
    if body.scope not in ("all", "user"):
        raise HTTPException(status_code=400, detail="scope must be 'all' or 'user'")
    if body.scope == "user" and not body.user_id:
        raise HTTPException(status_code=400, detail="user_id required when scope is 'user'")
    entry = await security_service.add_whitelist_entry(
        db, ip, body.scope,
        user_id=body.user_id if body.scope == "user" else None,
        tenant_id=current_user.tenant_id,
    )
    return {"id": entry.id, "ip_address": entry.ip_address, "scope": entry.scope, "user_id": entry.user_id}


@router.patch("/whitelist-ip/entries/{entry_id}")
async def update_whitelist_entry(
    entry_id: str,
    body: WhitelistEntryUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    entry = await security_service.update_whitelist_entry(
        db, entry_id,
        ip_address=body.ip_address,
        scope=body.scope,
        user_id=body.user_id,
        tenant_id=current_user.tenant_id,
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"id": entry.id, "ip_address": entry.ip_address, "scope": entry.scope, "user_id": entry.user_id}


@router.delete("/whitelist-ip/entries/{entry_id}", status_code=204)
async def delete_whitelist_entry(
    entry_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    ok = await security_service.delete_whitelist_entry(db, entry_id, tenant_id=current_user.tenant_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Entry not found")
