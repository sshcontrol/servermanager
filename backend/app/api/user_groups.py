"""User groups API: admin only."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database import get_db
from app.services import user_group_service as ugs
from app.services import server_service, sync_service
from app.services import user_key_service
from app.services.platform_key_service import PlatformKeyService
from app.config import get_settings
from app.services import audit_service
from app.core.auth import get_current_user, require_superuser
from app.models import User

router = APIRouter(prefix="/user-groups", tags=["user-groups"])


def _require_tenant_admin(current_user: User) -> User:
    """Require tenant admin (blocks platform superadmin). User groups are tenant-scoped."""
    if current_user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not current_user.tenant_id:
        raise HTTPException(status_code=403, detail="User groups are only available for tenant admins")
    if current_user.is_superuser:
        return current_user
    if any(r.name == "admin" for r in (current_user.roles or [])):
        return current_user
    raise HTTPException(status_code=403, detail="Admin access required")


class UserGroupCreate(BaseModel):
    name: str
    description: str | None = None


class UserGroupUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class AddMemberBody(BaseModel):
    user_id: str


@router.get("")
async def list_user_groups(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    _require_tenant_admin(current_user)
    return await ugs.list_user_groups(db, current_user.tenant_id)


@router.post("")
async def create_user_group(
    body: UserGroupCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    _require_tenant_admin(current_user)
    ug = await ugs.create_user_group(db, body.name, current_user.tenant_id, body.description)
    await audit_service.log(
        db, "user_group_created",
        resource_type="user_group", resource_id=ug.id,
        user_id=str(current_user.id), username=current_user.username,
        details=f"name={ug.name}",
    )
    return {"id": ug.id, "name": ug.name, "description": ug.description or "", "created_at": ug.created_at.isoformat()}


@router.get("/{group_id}")
async def get_user_group(
    group_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    _require_tenant_admin(current_user)
    ug = await ugs.get_user_group(db, group_id, current_user.tenant_id)
    if not ug:
        raise HTTPException(status_code=404, detail="User group not found")
    return {
        "id": ug.id,
        "name": ug.name,
        "description": ug.description or "",
        "created_at": ug.created_at.isoformat(),
        "members": [{"user_id": u.id, "username": u.username, "email": u.email} for u in ug.members],
    }


@router.patch("/{group_id}")
async def update_user_group(
    group_id: str,
    body: UserGroupUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    _require_tenant_admin(current_user)
    ug = await ugs.update_user_group(db, group_id, current_user.tenant_id, body.name, body.description)
    if not ug:
        raise HTTPException(status_code=404, detail="User group not found")
    return {"id": ug.id, "name": ug.name, "description": ug.description or ""}


@router.delete("/{group_id}", status_code=204)
async def delete_user_group(
    group_id: str,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    _require_tenant_admin(current_user)
    from app.core.auth import verify_destructive_verification_token
    verify_destructive_verification_token(request, current_user, "delete_user_group", group_id)
    ug = await ugs.get_user_group(db, group_id, current_user.tenant_id)
    if not ug:
        raise HTTPException(status_code=404, detail="User group not found")
    await ugs.delete_user_group(db, group_id, current_user.tenant_id)
    await audit_service.log(
        db, "user_group_deleted",
        resource_type="user_group", resource_id=group_id,
        user_id=str(current_user.id), username=current_user.username,
        details=f"name={ug.name}",
    )


@router.get("/{group_id}/members")
async def list_members(
    group_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    _require_tenant_admin(current_user)
    if not await ugs.get_user_group(db, group_id, current_user.tenant_id):
        raise HTTPException(status_code=404, detail="User group not found")
    return await ugs.list_members(db, group_id, current_user.tenant_id)


@router.post("/{group_id}/members")
async def add_member(
    group_id: str,
    body: AddMemberBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    _require_tenant_admin(current_user)
    if not await ugs.get_user_group(db, group_id, current_user.tenant_id):
        raise HTTPException(status_code=404, detail="User group not found")
    ok = await ugs.add_member(db, group_id, body.user_id, current_user.tenant_id)
    if not ok:
        raise HTTPException(status_code=400, detail="User not found, already in group, or user must belong to this tenant")
    await user_key_service.ensure_user_has_ssh_key(db, body.user_id)
    server_ids = await ugs.list_user_group_servers(db, group_id, current_user.tenant_id)
    for server_id in server_ids:
        await server_service.set_sync_requested(db, server_id)
    sync_results = []
    settings = get_settings()
    if settings.enable_ssh_sync:
        private_key = await PlatformKeyService.get_private_pem(db)
        if private_key:
            for server_id in server_ids:
                server = await server_service.get_server(db, server_id)
                if server:
                    result = await sync_service.run_sync_on_server(server, private_key)
                    if result["success"]:
                        await server_service.clear_sync_requested(db, server_id)
                    sync_results.append({
                        "server_id": server_id,
                        "server_name": getattr(server, "friendly_name", None) or server.hostname,
                        "success": result.get("success", False),
                        "error": result.get("error"),
                        "output": result.get("output"),
                    })
    if not sync_results:
        for server_id in server_ids:
            server = await server_service.get_server(db, server_id)
            name = getattr(server, "friendly_name", None) or getattr(server, "hostname", "") if server else server_id
            if settings.enable_ssh_sync:
                sync_results.append({"server_id": server_id, "server_name": name, "success": False, "error": "Platform SSH key not configured.", "output": None})
            else:
                sync_results.append({"server_id": server_id, "server_name": name, "success": True, "error": None, "output": "Sync requested. Target will apply within ~1 min (cron)."})
    return {"ok": True, "sync_results": sync_results}


@router.delete("/{group_id}/members/{user_id}")
async def remove_member(
    group_id: str,
    user_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    _require_tenant_admin(current_user)
    if not await ugs.get_user_group(db, group_id, current_user.tenant_id):
        raise HTTPException(status_code=404, detail="User group not found")
    await ugs.remove_member(db, group_id, user_id, current_user.tenant_id)
    server_ids = await ugs.list_user_group_servers(db, group_id, current_user.tenant_id)
    for server_id in server_ids:
        await server_service.set_sync_requested(db, server_id)
    sync_results = []
    settings = get_settings()
    if settings.enable_ssh_sync:
        private_key = await PlatformKeyService.get_private_pem(db)
        if private_key:
            for server_id in server_ids:
                server = await server_service.get_server(db, server_id)
                if server:
                    result = await sync_service.run_sync_on_server(server, private_key)
                    if result["success"]:
                        await server_service.clear_sync_requested(db, server_id)
                    sync_results.append({
                        "server_id": server_id,
                        "server_name": getattr(server, "friendly_name", None) or server.hostname,
                        "success": result.get("success", False),
                        "error": result.get("error"),
                        "output": result.get("output"),
                    })
    if not sync_results:
        for server_id in server_ids:
            server = await server_service.get_server(db, server_id)
            name = getattr(server, "friendly_name", None) or getattr(server, "hostname", "") if server else server_id
            if settings.enable_ssh_sync:
                sync_results.append({"server_id": server_id, "server_name": name, "success": False, "error": "Platform SSH key not configured.", "output": None})
            else:
                sync_results.append({"server_id": server_id, "server_name": name, "success": True, "error": None, "output": "Sync requested. Target will apply within ~1 min (cron)."})
    return {"ok": True, "sync_results": sync_results}
