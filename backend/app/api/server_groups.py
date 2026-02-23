"""Server groups API: admin only."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database import get_db
from app.services import server_group_service as sgs
from app.services import server_service, sync_service
from app.services import user_key_service
from app.services.platform_key_service import PlatformKeyService
from app.services import audit_service
from app.config import get_settings
from app.core.auth import get_current_user, require_superuser
from app.models import User

router = APIRouter(prefix="/server-groups", tags=["server-groups"])


class ServerGroupCreate(BaseModel):
    name: str
    description: str | None = None


class ServerGroupUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class GroupUserAccessBody(BaseModel):
    user_id: str
    role: str  # admin | user


class AddServerBody(BaseModel):
    server_id: str


@router.get("")
async def list_server_groups(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    return await sgs.list_server_groups(db)


@router.post("")
async def create_server_group(
    body: ServerGroupCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    sg = await sgs.create_server_group(db, body.name, body.description)
    await audit_service.log(
        db, "server_group_created",
        resource_type="server_group", resource_id=sg.id,
        user_id=str(current_user.id), username=current_user.username,
        details=f"name={sg.name}",
    )
    return {"id": sg.id, "name": sg.name, "description": sg.description or "", "created_at": sg.created_at.isoformat()}


@router.get("/{group_id}")
async def get_server_group(
    group_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    sg = await sgs.get_server_group(db, group_id)
    if not sg:
        raise HTTPException(status_code=404, detail="Server group not found")
    return {
        "id": sg.id,
        "name": sg.name,
        "description": sg.description or "",
        "created_at": sg.created_at.isoformat(),
        "servers": [{"id": s.id, "hostname": s.hostname, "friendly_name": getattr(s, "friendly_name", None)} for s in sg.servers],
        "access": [{"user_id": a.user_id, "username": a.user.username, "role": a.role} for a in sg.access],
    }


@router.patch("/{group_id}")
async def update_server_group(
    group_id: str,
    body: ServerGroupUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    sg = await sgs.update_server_group(db, group_id, body.name, body.description)
    if not sg:
        raise HTTPException(status_code=404, detail="Server group not found")
    return {"id": sg.id, "name": sg.name, "description": sg.description or ""}


@router.delete("/{group_id}", status_code=204)
async def delete_server_group(
    group_id: str,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    from app.core.auth import verify_destructive_verification_token
    verify_destructive_verification_token(request, current_user, "delete_server_group", group_id)
    sg = await sgs.get_server_group(db, group_id)
    if not sg:
        raise HTTPException(status_code=404, detail="Server group not found")
    await sgs.delete_server_group(db, group_id)
    await audit_service.log(
        db, "server_group_deleted",
        resource_type="server_group", resource_id=group_id,
        user_id=str(current_user.id), username=current_user.username,
        details=f"name={sg.name}",
    )


@router.get("/{group_id}/servers")
async def list_group_servers(
    group_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    if not await sgs.get_server_group(db, group_id):
        raise HTTPException(status_code=404, detail="Server group not found")
    return await sgs.list_group_servers(db, group_id)


@router.post("/{group_id}/servers")
async def add_server_to_group(
    group_id: str,
    body: AddServerBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    if not await sgs.get_server_group(db, group_id):
        raise HTTPException(status_code=404, detail="Server group not found")
    ok = await sgs.add_server_to_group(db, group_id, body.server_id)
    if not ok:
        raise HTTPException(status_code=400, detail="Server not found or already in group")
    await server_service.set_sync_requested(db, body.server_id)
    sync_results = []
    settings = get_settings()
    if settings.enable_ssh_sync:
        private_key = await PlatformKeyService.get_private_pem(db)
        if private_key:
            server = await server_service.get_server(db, body.server_id)
            if server:
                result = await sync_service.run_sync_on_server(server, private_key)
                if result["success"]:
                    await server_service.clear_sync_requested(db, body.server_id)
                sync_results.append({
                    "server_id": body.server_id,
                    "server_name": getattr(server, "friendly_name", None) or server.hostname,
                    "success": result.get("success", False),
                    "error": result.get("error"),
                    "output": result.get("output"),
                })
    if not sync_results:
        server = await server_service.get_server(db, body.server_id)
        name = getattr(server, "friendly_name", None) or getattr(server, "hostname", "") if server else body.server_id
        if settings.enable_ssh_sync:
            sync_results.append({"server_id": body.server_id, "server_name": name, "success": False, "error": "Platform SSH key not configured.", "output": None})
        else:
            sync_results.append({"server_id": body.server_id, "server_name": name, "success": True, "error": None, "output": "Sync requested. Target will apply within ~1 min (cron)."})
    return {"ok": True, "sync_results": sync_results}


@router.delete("/{group_id}/servers/{server_id}")
async def remove_server_from_group(
    group_id: str,
    server_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    if not await sgs.get_server_group(db, group_id):
        raise HTTPException(status_code=404, detail="Server group not found")
    await sgs.remove_server_from_group(db, group_id, server_id)
    await server_service.set_sync_requested(db, server_id)
    sync_results = []
    settings = get_settings()
    if settings.enable_ssh_sync:
        private_key = await PlatformKeyService.get_private_pem(db)
        if private_key:
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
        server = await server_service.get_server(db, server_id)
        name = getattr(server, "friendly_name", None) or getattr(server, "hostname", "") if server else server_id
        if settings.enable_ssh_sync:
            sync_results.append({"server_id": server_id, "server_name": name, "success": False, "error": "Platform SSH key not configured.", "output": None})
        else:
            sync_results.append({"server_id": server_id, "server_name": name, "success": True, "error": None, "output": "Sync requested. Target will apply within ~1 min (cron)."})
    return {"ok": True, "sync_results": sync_results}


@router.get("/{group_id}/access")
async def list_group_access(
    group_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    if not await sgs.get_server_group(db, group_id):
        raise HTTPException(status_code=404, detail="Server group not found")
    return await sgs.list_group_access(db, group_id)


@router.post("/{group_id}/access")
async def set_group_user_access(
    group_id: str,
    body: GroupUserAccessBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    if body.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="role must be admin or user")
    if not await sgs.get_server_group(db, group_id):
        raise HTTPException(status_code=404, detail="Server group not found")
    ok = await sgs.set_group_user_access(db, group_id, body.user_id, body.role)
    if not ok:
        raise HTTPException(status_code=400, detail="Failed to set access")
    await user_key_service.ensure_user_has_ssh_key(db, body.user_id)
    servers_list = await sgs.list_group_servers(db, group_id)
    for srv in servers_list:
        await server_service.set_sync_requested(db, srv["id"])
    sync_results = []
    settings = get_settings()
    if settings.enable_ssh_sync:
        private_key = await PlatformKeyService.get_private_pem(db)
        if private_key:
            for srv in servers_list:
                server = await server_service.get_server(db, srv["id"])
                if server:
                    result = await sync_service.run_sync_on_server(server, private_key)
                    if result["success"]:
                        await server_service.clear_sync_requested(db, srv["id"])
                    sync_results.append({
                        "server_id": srv["id"],
                        "server_name": srv.get("friendly_name") or srv.get("hostname", ""),
                        "success": result.get("success", False),
                        "error": result.get("error"),
                        "output": result.get("output"),
                    })
    if not sync_results:
        for srv in servers_list:
            if settings.enable_ssh_sync:
                sync_results.append({"server_id": srv["id"], "server_name": srv.get("friendly_name") or srv.get("hostname", ""), "success": False, "error": "Platform SSH key not configured.", "output": None})
            else:
                sync_results.append({"server_id": srv["id"], "server_name": srv.get("friendly_name") or srv.get("hostname", ""), "success": True, "error": None, "output": "Sync requested. Target will apply within ~1 min (cron)."})
    return {"ok": True, "sync_results": sync_results}


@router.delete("/{group_id}/access/{user_id}")
async def remove_group_user_access(
    group_id: str,
    user_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    if not await sgs.get_server_group(db, group_id):
        raise HTTPException(status_code=404, detail="Server group not found")
    await sgs.remove_group_user_access(db, group_id, user_id)
    servers_list = await sgs.list_group_servers(db, group_id)
    for srv in servers_list:
        await server_service.set_sync_requested(db, srv["id"])
    sync_results = []
    settings = get_settings()
    if settings.enable_ssh_sync:
        private_key = await PlatformKeyService.get_private_pem(db)
        if private_key:
            for srv in servers_list:
                server = await server_service.get_server(db, srv["id"])
                if server:
                    result = await sync_service.run_sync_on_server(server, private_key)
                    if result["success"]:
                        await server_service.clear_sync_requested(db, srv["id"])
                    sync_results.append({
                        "server_id": srv["id"],
                        "server_name": srv.get("friendly_name") or srv.get("hostname", ""),
                        "success": result.get("success", False),
                        "error": result.get("error"),
                        "output": result.get("output"),
                    })
    if not sync_results:
        for srv in servers_list:
            if settings.enable_ssh_sync:
                sync_results.append({"server_id": srv["id"], "server_name": srv.get("friendly_name") or srv.get("hostname", ""), "success": False, "error": "Platform SSH key not configured.", "output": None})
            else:
                sync_results.append({"server_id": srv["id"], "server_name": srv.get("friendly_name") or srv.get("hostname", ""), "success": True, "error": None, "output": "Sync requested. Target will apply within ~1 min (cron)."})
    return {"ok": True, "sync_results": sync_results}
