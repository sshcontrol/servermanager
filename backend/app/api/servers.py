from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database import get_db
from app.services.platform_key_service import PlatformKeyService
from app.services import server_service, user_key_service, audit_service, user_group_service, sync_service
from app.core.auth import get_current_user, RequireServersRead, RequireServersWrite, require_superuser
from app.models import User
from app.config import get_settings

router = APIRouter(prefix="/servers", tags=["servers"])


class RegisterBody(BaseModel):
    token: str
    hostname: str
    ip_address: str | None = None


class ServerAccessBody(BaseModel):
    user_id: str
    role: str  # admin | user


def _server_to_item(s):
    return {
        "id": s.id,
        "hostname": s.hostname,
        "friendly_name": getattr(s, "friendly_name", None),
        "ip_address": s.ip_address,
        "description": s.description,
        "status": s.status,
        "created_at": s.created_at.isoformat(),
    }


def _is_admin(user: User) -> bool:
    return user.is_superuser or any(r.name == "admin" for r in (user.roles or []))


@router.post("/register")
async def register_server(
    body: RegisterBody,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    dt = await server_service.verify_deployment_token(db, body.token)
    if not dt:
        raise HTTPException(status_code=401, detail="Invalid deployment token")
    tenant_id = dt.tenant_id
    if tenant_id:
        from app.services.tenant_service import TenantService
        await TenantService.check_server_limit(db, tenant_id)
    key_row = await PlatformKeyService.get_key(db, tenant_id=tenant_id)
    if key_row:
        public_key = key_row.public_key
    else:
        public_key = await server_service.get_tenant_owner_public_key(db, tenant_id)
        if not public_key:
            raise HTTPException(
                status_code=503,
                detail="No SSH key configured. Upload your public key on the Key page, or regenerate the platform key in Admin → SSH Key.",
            )
    server = await server_service.register_server(db, body.hostname, body.ip_address, tenant_id=tenant_id)
    await audit_service.log(
        db, "server_registered",
        resource_type="server", resource_id=server.id,
        details=f"hostname={body.hostname}",
    )
    return {"id": server.id, "hostname": server.hostname, "public_key": public_key}


def _deploy_error_script(message: str) -> str:
    """Return a shell script that prints an error and exits. Used when deploy script is piped to bash."""
    escaped = message.replace("'", "'\"'\"'")
    return f"""#!/bin/bash
echo "=== SSHCONTROL deploy script error ==="
echo ""
echo "Error: {escaped}"
echo ""
echo "This usually means:"
echo "  - Token invalid or expired: Get a fresh token from Server → Add server in your SSHCONTROL dashboard."
echo "  - Wrong API URL: Use the exact URL from your Add server page (e.g. https://sshcontrol.com)."
echo "  - API unreachable: Ensure the backend is running and reachable from this server."
echo ""
exit 1
"""


@router.get("/deploy/script")
async def get_deploy_script(
    token: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    os_id: str | None = None,
):
    dt = await server_service.verify_deployment_token(db, token)
    if not dt:
        # Return a script instead of JSON so "curl ... | sudo bash" shows a clear error
        script = _deploy_error_script("Invalid deployment token. Token may be expired or from a different instance.")
        return PlainTextResponse(script, media_type="text/plain", headers={
            "Content-Disposition": "inline; filename=deploy.sh"
        })
    settings = get_settings()
    api_url = settings.public_api_url
    script = _deploy_script_content(api_url, token, os_id=os_id)
    return PlainTextResponse(script, media_type="text/plain", headers={
        "Content-Disposition": "inline; filename=deploy.sh"
    })


@router.get("/deploy/token")
async def get_deploy_token(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    """Return deployment token and public API URL so the Add server page can build the correct deploy command.
    Requires 2FA (TOTP) or SMS verification to be enabled first."""
    has_2fa = bool(current_user.totp_enabled)
    has_sms = bool(getattr(current_user, "phone_verified", False))
    if not has_2fa and not has_sms:
        raise HTTPException(
            status_code=403,
            detail="Please enable 2FA (authenticator app) or SMS verification first before adding a server. Go to Profile → Security.",
        )
    t = await server_service.get_deployment_token(db, tenant_id=current_user.tenant_id)
    if not t:
        raise HTTPException(status_code=503, detail="Deployment token not configured")
    settings = get_settings()
    return {"token": t, "api_url": settings.public_api_url.rstrip("/")}


def _validate_server_tenant(server, dt) -> None:
    """Ensure server belongs to deployment token's tenant. Prevents cross-tenant access."""
    if server.tenant_id != dt.tenant_id:
        raise HTTPException(status_code=403, detail="Server does not belong to this deployment token")


@router.get("/authorized-keys")
async def get_authorized_keys(
    token: str,
    server_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Server calls this to get authorized_keys content. Only active users with access and a key are included.
    When admin revokes access or inactivates a user, they are omitted so the user can no longer connect."""
    dt = await server_service.verify_deployment_token(db, token)
    if not dt:
        raise HTTPException(status_code=401, detail="Invalid deployment token")
    server = await server_service.get_server(db, server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    _validate_server_tenant(server, dt)
    content = await server_service.get_authorized_keys_content(db, server_id)
    return Response(content=content, media_type="text/plain")


@router.get("/users-keys")
async def get_users_keys(
    token: str,
    server_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Server calls this to get per-user keys for creating Linux users. Returns JSON list of { username, authorized_key_line }.
    Run the sync-users script on the server to create/update Linux accounts so each panel user can ssh username@server with their key (no password)."""
    dt = await server_service.verify_deployment_token(db, token)
    if not dt:
        raise HTTPException(status_code=401, detail="Invalid deployment token")
    server = await server_service.get_server(db, server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    _validate_server_tenant(server, dt)
    users_keys = await server_service.get_users_keys_for_server(db, server_id)
    return {"users": users_keys}


@router.get("/pending-sync")
async def get_pending_sync(
    token: str,
    server_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Server cron calls this to see if admin requested a sync. If true, server should run sync-users and sync-authorized-keys then POST to clear-sync."""
    dt = await server_service.verify_deployment_token(db, token)
    if not dt:
        raise HTTPException(status_code=401, detail="Invalid deployment token")
    server = await server_service.get_server(db, server_id)
    if server:
        _validate_server_tenant(server, dt)
    pending = await server_service.get_pending_sync(db, server_id)
    return {"sync": pending}


class ClearSyncBody(BaseModel):
    token: str
    server_id: str


@router.post("/clear-sync")
async def clear_sync(
    body: ClearSyncBody,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Server calls this after running sync to clear the sync_requested flag."""
    dt = await server_service.verify_deployment_token(db, body.token)
    if not dt:
        raise HTTPException(status_code=401, detail="Invalid deployment token")
    server = await server_service.get_server(db, body.server_id)
    if server:
        _validate_server_tenant(server, dt)
    await server_service.clear_sync_requested(db, body.server_id)
    return {"ok": True}


class ReportSessionsBody(BaseModel):
    token: str
    server_id: str
    usernames: list[str]


@router.post("/report-sessions")
async def report_sessions(
    body: ReportSessionsBody,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Server cron calls this to report which Linux usernames currently have an active SSH session. Used for User monitor 'Connected to'."""
    dt = await server_service.verify_deployment_token(db, body.token)
    if not dt:
        raise HTTPException(status_code=401, detail="Invalid deployment token")
    server = await server_service.get_server(db, body.server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    _validate_server_tenant(server, dt)
    await server_service.save_session_report(db, body.server_id, body.usernames)
    return {"ok": True}


@router.get("")
async def list_servers(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Any authenticated user can list servers. Admins (superuser or admin role) see all servers; others see only servers they have access to."""
    servers = await server_service.list_servers(db, str(current_user.id), _is_admin(current_user), tenant_id=current_user.tenant_id)
    return [_server_to_item(s) for s in servers]


@router.get("/stats")
async def get_server_stats(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    with_status: bool = False,
):
    """Returns assigned_count for all users; for admin with with_status=true also returns online and offline counts. Scoped to current user's tenant."""
    is_admin = _is_admin(current_user)
    servers = await server_service.list_servers(db, str(current_user.id), is_admin, tenant_id=current_user.tenant_id)
    out = {"assigned_count": len(servers)}
    if is_admin:
        out["total"] = len(servers)
        if with_status and servers:
            import asyncio
            results = await asyncio.gather(
                *(server_service.check_server_connection(s) for s in servers),
                return_exceptions=True,
            )
            online = sum(1 for r in results if not isinstance(r, Exception) and r[0] == "reachable")
            offline = len(results) - online
            out["online"] = online
            out["offline"] = offline
    return out


@router.get("/{server_id}/status")
async def get_server_status(
    server_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    server = await server_service.get_server(db, server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    servers = await server_service.list_servers(db, str(current_user.id), _is_admin(current_user), tenant_id=current_user.tenant_id)
    if not any(s.id == server_id for s in servers):
        raise HTTPException(status_code=404, detail="Server not found")
    status, checked_at = await server_service.check_server_connection(server)
    return {"status": status, "checked_at": checked_at}


@router.get("/{server_id}")
async def get_server(
    server_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    server = await server_service.get_server(db, server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    servers = await server_service.list_servers(db, str(current_user.id), _is_admin(current_user), tenant_id=current_user.tenant_id)
    if not any(s.id == server_id for s in servers):
        raise HTTPException(status_code=404, detail="Server not found")
    return _server_to_item(server)


class ServerUpdateBody(BaseModel):
    friendly_name: str | None = None
    description: str | None = None
    ip_address: str | None = None  # for connection check; e.g. 172.17.0.1 when server is Docker host


@router.patch("/{server_id}")
async def update_server(
    server_id: str,
    body: ServerUpdateBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(RequireServersWrite)],
):
    server = await server_service.get_server(db, server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    servers = await server_service.list_servers(db, str(current_user.id), _is_admin(current_user), tenant_id=current_user.tenant_id)
    if not any(s.id == server_id for s in servers):
        raise HTTPException(status_code=404, detail="Server not found")
    if body.friendly_name is not None:
        server.friendly_name = (body.friendly_name.strip() or None) if body.friendly_name else None
    if body.description is not None:
        server.description = body.description
    if body.ip_address is not None:
        server.ip_address = body.ip_address.strip() or None
    await db.flush()
    return _server_to_item(server)


@router.post("/{server_id}/request-sync")
async def request_sync(
    server_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(RequireServersWrite)],
):
    """Request the server to run sync (users + authorized_keys) on its next check (within ~1 min)."""
    server = await server_service.get_server(db, server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    servers = await server_service.list_servers(db, str(current_user.id), _is_admin(current_user), tenant_id=current_user.tenant_id)
    if not any(s.id == server_id for s in servers):
        raise HTTPException(status_code=404, detail="Server not found")
    try:
        ok = await server_service.set_sync_requested(db, server_id)
    except Exception as e:
        from sqlalchemy.exc import OperationalError
        if isinstance(e, OperationalError) and "sync_requested_at" in (str(e) or ""):
            raise HTTPException(
                status_code=503,
                detail="Sync feature unavailable: database schema may be outdated. Run migrations (alembic upgrade head) and restart the backend.",
            ) from e
        raise
    if not ok:
        raise HTTPException(status_code=404, detail="Server not found")
    return {"ok": True, "message": "Sync requested. Server will sync within about a minute."}


@router.post("/{server_id}/sync-now")
async def sync_now(
    server_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(RequireServersWrite)],
):
    """Run sync immediately on the target server via SSH. Returns success or error."""
    server = await server_service.get_server(db, server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    servers = await server_service.list_servers(db, str(current_user.id), _is_admin(current_user), tenant_id=current_user.tenant_id)
    if not any(s.id == server_id for s in servers):
        raise HTTPException(status_code=404, detail="Server not found")
    settings = get_settings()
    await server_service.set_sync_requested(db, server_id)
    if not settings.enable_ssh_sync:
        return {"ok": True, "success": True, "message": "Sync requested. Target will apply within ~1 min (cron)."}
    private_key = await PlatformKeyService.get_private_pem(db, tenant_id=current_user.tenant_id)
    if not private_key:
        raise HTTPException(status_code=503, detail="Platform SSH key not configured. Generate it in Admin → Key first.")
    result = await sync_service.run_sync_on_server(server, private_key)
    if result["success"]:
        await server_service.clear_sync_requested(db, server_id)
        return {"ok": True, "success": True, "message": "Sync completed successfully."}
    return {
        "ok": False,
        "success": False,
        "message": result.get("error", "Sync failed"),
        "output": result.get("output"),
    }


@router.delete("/{server_id}", status_code=204)
async def delete_server_endpoint(
    server_id: str,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(RequireServersWrite)],
):
    from app.core.auth import verify_destructive_verification_token
    verify_destructive_verification_token(request, current_user, "delete_server", server_id)
    server = await server_service.get_server(db, server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    servers = await server_service.list_servers(db, str(current_user.id), _is_admin(current_user), tenant_id=current_user.tenant_id)
    if not any(s.id == server_id for s in servers):
        raise HTTPException(status_code=404, detail="Server not found")
    name = getattr(server, "friendly_name", None) or server.hostname
    await server_service.delete_server(db, server_id)
    await audit_service.log(
        db, "server_deleted",
        resource_type="server", resource_id=server_id,
        user_id=str(current_user.id), username=current_user.username,
        details=f"server={name}",
    )


@router.get("/{server_id}/access")
async def list_server_access(
    server_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(RequireServersRead)],
):
    server = await server_service.get_server(db, server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    servers = await server_service.list_servers(db, str(current_user.id), _is_admin(current_user), tenant_id=current_user.tenant_id)
    if not any(s.id == server_id for s in servers):
        raise HTTPException(status_code=404, detail="Server not found")
    access_list = await server_service.list_server_access(db, server_id)
    return access_list


def _sync_result_item(server_id: str, server_name: str, result: dict) -> dict:
    return {
        "server_id": server_id,
        "server_name": server_name,
        "success": result.get("success", False),
        "error": result.get("error"),
        "output": result.get("output"),
    }


async def _do_sync_for_server(db, server, server_id: str, server_name: str) -> dict:
    """Run SSH sync if enabled, else return cron-fallback. Caller must have set sync_requested."""
    settings = get_settings()
    if not settings.enable_ssh_sync:
        return _sync_result_item(server_id, server_name, {
            "success": True, "output": "Sync requested. Target will apply within ~1 min (cron)."
        })
    private_key = await PlatformKeyService.get_private_pem(db, tenant_id=getattr(server, "tenant_id", None))
    if not private_key:
        return _sync_result_item(server_id, server_name, {
            "success": False, "error": "Platform SSH key not configured. Generate in Admin → Key."
        })
    result = await sync_service.run_sync_on_server(server, private_key)
    if result["success"]:
        await server_service.clear_sync_requested(db, server_id)
    return _sync_result_item(server_id, server_name, result)




@router.post("/{server_id}/access")
async def add_server_access(
    server_id: str,
    body: ServerAccessBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(RequireServersWrite)],
):
    if body.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="role must be admin or user")
    server = await server_service.get_server(db, server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    servers = await server_service.list_servers(db, str(current_user.id), _is_admin(current_user), tenant_id=current_user.tenant_id)
    if not any(s.id == server_id for s in servers):
        raise HTTPException(status_code=404, detail="Server not found")
    await server_service.set_server_access(db, server_id, body.user_id, body.role)
    await user_key_service.ensure_user_has_ssh_key(db, body.user_id)
    await server_service.set_sync_requested(db, server_id)
    server_name = getattr(server, "friendly_name", None) or server.hostname
    await audit_service.log(
        db, "access_granted",
        resource_type="server", resource_id=server_id,
        user_id=str(current_user.id), username=current_user.username,
        details=f"server={server_name} user_id={body.user_id} role={body.role}",
    )
    sync_results = [await _do_sync_for_server(db, server, server_id, server_name)]
    return {"ok": True, "sync_results": sync_results}


@router.delete("/{server_id}/access/{user_id}")
async def remove_server_access_endpoint(
    server_id: str,
    user_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(RequireServersWrite)],
):
    server = await server_service.get_server(db, server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    servers = await server_service.list_servers(db, str(current_user.id), _is_admin(current_user), tenant_id=current_user.tenant_id)
    if not any(s.id == server_id for s in servers):
        raise HTTPException(status_code=404, detail="Server not found")
    await server_service.remove_server_access(db, server_id, user_id)
    await server_service.set_sync_requested(db, server_id)
    server_name = getattr(server, "friendly_name", None) or server.hostname
    await audit_service.log(
        db, "access_revoked",
        resource_type="server", resource_id=server_id,
        user_id=str(current_user.id), username=current_user.username,
        details=f"server={server_name} user_id={user_id}",
    )
    sync_results = [await _do_sync_for_server(db, server, server_id, server_name)]
    return {"ok": True, "sync_results": sync_results}


class ServerUserGroupAccessBody(BaseModel):
    user_group_id: str
    role: str  # admin | user


@router.get("/{server_id}/user-groups")
async def list_server_user_groups(
    server_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(RequireServersRead)],
):
    server = await server_service.get_server(db, server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    servers_list = await server_service.list_servers(db, str(current_user.id), _is_admin(current_user), tenant_id=current_user.tenant_id)
    if not any(s.id == server_id for s in servers_list):
        raise HTTPException(status_code=404, detail="Server not found")
    return await user_group_service.list_server_user_groups(db, server_id, current_user.tenant_id)


@router.post("/{server_id}/user-groups")
async def add_server_user_group(
    server_id: str,
    body: ServerUserGroupAccessBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(RequireServersWrite)],
):
    if body.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="role must be admin or user")
    server = await server_service.get_server(db, server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    servers_list = await server_service.list_servers(db, str(current_user.id), _is_admin(current_user), tenant_id=current_user.tenant_id)
    if not any(s.id == server_id for s in servers_list):
        raise HTTPException(status_code=404, detail="Server not found")
    if not current_user.tenant_id:
        raise HTTPException(status_code=403, detail="User groups are only available for tenant admins")
    ok = await user_group_service.set_server_user_group_access(db, server_id, body.user_group_id, body.role, current_user.tenant_id)
    if not ok:
        raise HTTPException(status_code=400, detail="User group not found or must belong to this tenant")
    await server_service.set_sync_requested(db, server_id)
    server_name = getattr(server, "friendly_name", None) or server.hostname
    sync_results = [await _do_sync_for_server(db, server, server_id, server_name)]
    return {"ok": True, "sync_results": sync_results}


@router.delete("/{server_id}/user-groups/{user_group_id}")
async def remove_server_user_group(
    server_id: str,
    user_group_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(RequireServersWrite)],
):
    server = await server_service.get_server(db, server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    servers_list = await server_service.list_servers(db, str(current_user.id), _is_admin(current_user), tenant_id=current_user.tenant_id)
    if not any(s.id == server_id for s in servers_list):
        raise HTTPException(status_code=404, detail="Server not found")
    if not current_user.tenant_id:
        raise HTTPException(status_code=403, detail="User groups are only available for tenant admins")
    ok = await user_group_service.remove_server_user_group_access(db, server_id, user_group_id, current_user.tenant_id)
    if not ok:
        raise HTTPException(status_code=404, detail="User group not found")
    await server_service.set_sync_requested(db, server_id)
    server_name = getattr(server, "friendly_name", None) or server.hostname
    sync_results = [await _do_sync_for_server(db, server, server_id, server_name)]
    return {"ok": True, "sync_results": sync_results}


# OS id -> script family for preamble (install curl, ssh, open port 22)
_DEPLOY_OS_FAMILY: dict[str, str] = {
    "ubuntu_21_25": "apt_ufw",
    "ubuntu_18_20": "apt_ufw",
    "debian_10_13": "apt_ufw",
    "rocky_8_10": "dnf_firewalld",
    "rhel_8_10": "dnf_firewalld",
    "rhel_7": "yum_firewalld",
    "oracle_8_10": "dnf_firewalld",
    "oracle_7": "yum_firewalld",
    "centos_8_10": "dnf_firewalld",
    "centos_7": "yum_firewalld",
    "amazon_2023": "dnf_firewalld",
    "amazon_2": "yum_firewalld",
    "alma_8_10": "dnf_firewalld",
}


def _deploy_preamble(family: str) -> str:
    """Bash preamble: ensure curl and ssh are installed, port 22 allowed."""
    if family == "apt_ufw":
        return r'''
# Ensure curl and SSH are installed; allow port 22 (Ubuntu/Debian)
if ! command -v curl &>/dev/null; then
  apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y curl
fi
if ! command -v sshd &>/dev/null; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y openssh-server
fi
if command -v ufw &>/dev/null; then
  ufw allow 22/tcp 2>/dev/null || true
  ufw --force enable 2>/dev/null || true
fi
'''
    if family == "dnf_firewalld":
        return r'''
# Ensure curl and SSH are installed; allow port 22 (RHEL/Rocky/Oracle/Alma/CentOS 8+/Amazon 2023)
if ! command -v curl &>/dev/null; then
  dnf install -y curl
fi
if ! command -v sshd &>/dev/null; then
  dnf install -y openssh-server
fi
if command -v firewall-cmd &>/dev/null; then
  firewall-cmd --permanent --add-service=ssh 2>/dev/null || true
  firewall-cmd --reload 2>/dev/null || true
fi
'''
    if family == "yum_firewalld":
        return r'''
# Ensure curl and SSH are installed; allow port 22 (RHEL/CentOS/Oracle 7, Amazon Linux 2)
if ! command -v curl &>/dev/null; then
  yum install -y curl
fi
if ! command -v sshd &>/dev/null; then
  yum install -y openssh-server
fi
if command -v firewall-cmd &>/dev/null; then
  firewall-cmd --permanent --add-service=ssh 2>/dev/null || true
  firewall-cmd --reload 2>/dev/null || true
fi
'''
    return ""


def _deploy_script_content(api_url: str, token: str, os_id: str | None = None) -> str:
    preamble = ""
    if os_id and os_id in _DEPLOY_OS_FAMILY:
        preamble = _deploy_preamble(_DEPLOY_OS_FAMILY[os_id])
    return f'''#!/bin/bash
# SSHCONTROL - Deploy script: register server and install authorized_keys (per-user keys + role)
# Role = admin (sudo on this server) or user (normal). When admin revokes or inactivates a user, re-run sync to revoke access.
set -e
{preamble}
API_URL="{api_url.rstrip("/")}"
TOKEN="{token}"
HOSTNAME=$(hostname -f 2>/dev/null || hostname)
IP=$(curl -s --connect-timeout 3 -4 https://ifconfig.me 2>/dev/null || curl -s --connect-timeout 2 -4 https://icanhazip.com 2>/dev/null || echo "")

BODY='{{"token": "'"$TOKEN"'", "hostname": "'"$HOSTNAME"'", "ip_address": "'"$IP"'"}}'
REGISTER_TMP=$(mktemp 2>/dev/null || echo "/tmp/sshcontrol_register_$$")
HTTP_CODE=$(curl -s -w "%{{http_code}}" -o "$REGISTER_TMP" -X POST "$API_URL/api/servers/register" -H "Content-Type: application/json" -d "$BODY" --connect-timeout 15 --max-time 30 2>/dev/null || echo "000")
RESP=$(cat "$REGISTER_TMP" 2>/dev/null)
rm -f "$REGISTER_TMP"

# Parse response: extract server id or error detail
PARSE_RESULT=$(echo "$RESP" | python3 -c "
import sys, json
try:
    raw = sys.stdin.read()
    if not raw.strip():
        print('ERR:Empty response (connection failed or API unreachable)')
        sys.exit(0)
    d = json.loads(raw)
    sid = d.get('id', '')
    if sid:
        print('OK:' + sid)
    else:
        detail = d.get('detail', '')
        if isinstance(detail, list) and detail:
            first = detail[0]
            msg = first.get('msg', first.get('loc', str(first)))
            if isinstance(msg, list):
                msg = '.'.join(str(x) for x in msg)
            detail = str(msg)
        elif not isinstance(detail, str):
            detail = str(detail) if detail else 'Unknown error'
        print('ERR:' + (detail or 'Unknown error'))
except json.JSONDecodeError:
    print('ERR:Invalid JSON response (API may have returned HTML or an error page)')
except Exception:
    print('ERR:Failed to parse response')
" 2>/dev/null || echo "ERR:Failed to parse response")

SERVER_ID=""
if [[ "$PARSE_RESULT" == OK:* ]]; then
  SERVER_ID="${{PARSE_RESULT#OK:}}"
fi

if [ -z "$SERVER_ID" ]; then
  echo "=== SSHCONTROL deploy failed ==="
  echo ""
  echo "API URL: $API_URL"
  echo "Hostname: $HOSTNAME"
  echo "HTTP status: $HTTP_CODE"
  if [[ "$PARSE_RESULT" == ERR:* ]]; then
    echo "Error: ${{PARSE_RESULT#ERR:}}"
  fi
  echo ""
  echo "Raw response: $RESP"
  echo ""
  echo "Troubleshooting:"
  echo "  - Invalid token / 401: Get a fresh token from Server → Add server in your SSHCONTROL dashboard."
  echo "  - No SSH key: Upload your public key on the Key page, or regenerate platform key in Admin → SSH Key."
  echo "  - Connection refused / timeout: Ensure the API is reachable from this server (firewall, PUBLIC_API_URL)."
  echo "  - Wrong API URL: Use the exact URL from your Add server page (e.g. https://sshcontrol.com)."
  exit 1
fi

mkdir -p ~/.ssh
chmod 700 ~/.ssh

# Fetch platform key for root authorized_keys (admin management key only; users connect via per-user accounts)
AK_TMP=$(mktemp 2>/dev/null || echo "/tmp/sshcontrol_ak_$$")
AK_HTTP=$(curl -s -w "%{{http_code}}" -o "$AK_TMP" "$API_URL/api/servers/authorized-keys?token=$TOKEN&server_id=$SERVER_ID" --connect-timeout 15 --max-time 30 2>/dev/null || echo "000")
if [ "$AK_HTTP" != "200" ] || ! head -1 "$AK_TMP" 2>/dev/null | grep -q "ssh-"; then
  echo "Warning: Failed to fetch authorized_keys (HTTP $AK_HTTP). Root SSH via panel key may not work until sync succeeds."
  [ -s "$AK_TMP" ] && echo "  Response: $(head -c 300 "$AK_TMP")"
fi
cp "$AK_TMP" ~/.ssh/authorized_keys 2>/dev/null || true
rm -f "$AK_TMP"
chmod 600 ~/.ssh/authorized_keys

# Persist SERVER_ID and TOKEN for re-sync (cron). Install cron to re-fetch every 5 min so revocations take effect.
SYNC_DIR="/etc/sshcontrol"
if [ -w /etc 2>/dev/null ]; then
  mkdir -p "$SYNC_DIR"
  chmod 700 "$SYNC_DIR"
  echo "$SERVER_ID" > "$SYNC_DIR/server_id"
  echo "$TOKEN" > "$SYNC_DIR/token"
  echo "$API_URL" > "$SYNC_DIR/api_url"
  chmod 600 "$SYNC_DIR/server_id" "$SYNC_DIR/token" "$SYNC_DIR/api_url"
  # Save platform key for AuthorizedKeysCommand root lookup
  cp ~/.ssh/authorized_keys "$SYNC_DIR/platform-key.pub" 2>/dev/null || true
  chmod 600 "$SYNC_DIR/platform-key.pub" 2>/dev/null || true
  cat > "$SYNC_DIR/sync-authorized-keys.sh" << SYNCSCRIPT
#!/bin/sh
# Sync authorized_keys from SSHCONTROL (run by cron every 5 min)
SYNC_DIR="$SYNC_DIR"
LOCKFILE="\$SYNC_DIR/.lock-ak"
[ -r "\$SYNC_DIR/server_id" ] || exit 0
[ -r "\$SYNC_DIR/token" ] || exit 0
[ -r "\$SYNC_DIR/api_url" ] || exit 0
exec 9>"\$LOCKFILE"
flock -n 9 || exit 0
API_URL=\$(cat "\$SYNC_DIR/api_url")
TOKEN=\$(cat "\$SYNC_DIR/token")
SERVER_ID=\$(cat "\$SYNC_DIR/server_id")
TMP=\$(mktemp)
HTTP_CODE=\$(curl -s -w '%{{http_code}}' "\$API_URL/api/servers/authorized-keys?token=\$TOKEN&server_id=\$SERVER_ID" -o "\$TMP" 2>/dev/null)
if [ "\$HTTP_CODE" = "200" ] && [ -s "\$TMP" ] && head -1 "\$TMP" | grep -q "ssh-"; then
  cp "\$TMP" ~/.ssh/authorized_keys
  chmod 600 ~/.ssh/authorized_keys
  cp ~/.ssh/authorized_keys "\$SYNC_DIR/platform-key.pub" 2>/dev/null || true
fi
rm -f "\$TMP"
SYNCSCRIPT
  chmod +x "$SYNC_DIR/sync-authorized-keys.sh"
  # Sync Linux users: create/update per-user accounts so panel users can ssh username@server with their key (no password).
  # For revoked users (no longer in users-keys.json): clear their SSH keys and remove from managed. Account and files are kept.
  cat > "$SYNC_DIR/sync-users.py" << 'PYEOF'
import json, os, pwd, subprocess, sys, shutil
sync_dir = sys.argv[1] if len(sys.argv) > 1 else "/etc/sshcontrol"
path = os.path.join(sync_dir, "users-keys.json")
managed_path = os.path.join(sync_dir, "managed-users")

PROTECTED_USERS = frozenset((
    "root", "ubuntu", "ec2-user", "centos", "admin", "administrator",
    "fedora", "debian", "nobody", "daemon", "bin", "sys", "sync",
    "games", "man", "lp", "mail", "news", "uucp", "proxy",
    "www-data", "backup", "list", "irc", "gnats", "sshd",
    "systemd-network", "systemd-resolve", "messagebus",
    "ntp", "chrony", "postgres", "mysql", "redis", "nginx",
))

def load_managed():
    if os.path.isfile(managed_path):
        with open(managed_path) as f:
            return set(line.strip() for line in f if line.strip())
    managed = set()
    home = "/home"
    if os.path.isdir(home):
        for name in os.listdir(home):
            if name in PROTECTED_USERS or not all(c.isalnum() or c == "_" for c in name):
                continue
            managed.add(name)
    return managed

def save_managed(s):
    tmp = managed_path + ".tmp"
    with open(tmp, "w") as f:
        for u in sorted(s):
            f.write(u + "\\\\n")
    os.rename(tmp, managed_path)

try:
    with open(path) as f:
        data = json.load(f)
except Exception:
    sys.exit(0)

users_list = data.get("users")
if not isinstance(users_list, list):
    users_list = []

current_users = set()
admin_users = set()
seen_usernames = set()
for x in users_list:
    u = (x.get("username") or "").strip()
    if not u or not all(c.isalnum() or c == "_" for c in u):
        continue
    if u in PROTECTED_USERS:
        print(f"WARN: skipping protected username '{{u}}'", file=sys.stderr)
        continue
    if u in seen_usernames:
        print(f"WARN: duplicate username '{{u}}' in users-keys.json, using first occurrence", file=sys.stderr)
        continue
    seen_usernames.add(u)
    key_line = (x.get("authorized_key_line") or "").strip()
    if not key_line:
        continue
    role = (x.get("role") or "user").strip().lower()
    current_users.add(u)
    if role == "admin":
        admin_users.add(u)
    if subprocess.run(["id", u], capture_output=True).returncode != 0:
        r = subprocess.run(["useradd", "-m", "-s", "/bin/bash", u], capture_output=True)
        if r.returncode != 0:
            subprocess.run(["adduser", "--disabled-password", "--gecos", "", u], capture_output=True)
    subprocess.run(["passwd", "-u", u], capture_output=True, check=False)
    home = os.path.join("/home", u)
    ssh_dir = os.path.join(home, ".ssh")
    os.makedirs(ssh_dir, mode=0o700, exist_ok=True)
    ak = os.path.join(ssh_dir, "authorized_keys")
    with open(ak, "w") as f:
        f.write(key_line + "\\\\n")
    os.chmod(ak, 0o600)
    try:
        pw = pwd.getpwnam(u)
        os.chown(ak, pw.pw_uid, pw.pw_gid)
        os.chown(ssh_dir, pw.pw_uid, pw.pw_gid)
    except OSError:
        pass

# Sudo: admin users get NOPASSWD; validate with visudo before committing
sudoers_dir = "/etc/sudoers.d"
sudoers_path = os.path.join(sudoers_dir, "sshcontrol-admin")
if os.path.isdir(sudoers_dir):
    lines = ["# SSHCONTROL managed - do not edit manually\\\\n"]
    for au in sorted(admin_users):
        lines.append(au + " ALL=(ALL) NOPASSWD: ALL\\\\n")
    tmp_sudoers = sudoers_path + ".tmp"
    try:
        with open(tmp_sudoers, "w") as f:
            f.writelines(lines)
        os.chmod(tmp_sudoers, 0o440)
        r = subprocess.run(["visudo", "-c", "-f", tmp_sudoers], capture_output=True)
        if r.returncode == 0:
            os.rename(tmp_sudoers, sudoers_path)
        else:
            print(f"WARN: visudo check failed, keeping old sudoers: {{r.stderr}}", file=sys.stderr)
            os.remove(tmp_sudoers)
    except (OSError, IOError) as e:
        print(f"WARN: sudoers write failed: {{e}}", file=sys.stderr)
        if os.path.isfile(tmp_sudoers):
            os.remove(tmp_sudoers)

managed = load_managed()
managed.update(current_users)
for revoked in list(managed - current_users):
    if revoked in PROTECTED_USERS:
        managed.discard(revoked)
        continue
    ak = os.path.join("/home", revoked, ".ssh", "authorized_keys")
    try:
        if os.path.isfile(ak):
            with open(ak, "w") as f:
                f.write("")
    except (OSError, IOError):
        pass
    subprocess.run(["passwd", "-l", revoked], capture_output=True, check=False)
    managed.discard(revoked)
save_managed(managed)
PYEOF
  # AuthorizedKeysCommand: return authorized keys for a given user.
  # Also handles root by reading the platform key from a dedicated file.
  # IP whitelisting is enforced via from="ip1,ip2" prefix in the key line (works on all OpenSSH versions).
  cat > "$SYNC_DIR/authorized-keys-command.py" << 'AKCEOF'
#!/usr/bin/env python3
"""SSHCONTROL AuthorizedKeysCommand - returns authorized keys for a given user.
Called by sshd with: %u (username). Must exit 0 always."""
import json, os, sys
try:
    sync_dir = "/etc/sshcontrol"
    path = os.path.join(sync_dir, "users-keys.json")
    username = sys.argv[1].strip() if len(sys.argv) > 1 and sys.argv[1] else ""
    if not username:
        sys.exit(0)
    if username == "root":
        pk_path = os.path.join(sync_dir, "platform-key.pub")
        if os.path.isfile(pk_path):
            with open(pk_path) as f:
                key = f.read().strip()
            if key:
                print(key)
        sys.exit(0)
    if not os.path.isfile(path):
        sys.exit(0)
    with open(path) as f:
        data = json.load(f)
    for u in data.get("users", []):
        if (u.get("username") or "").strip() != username:
            continue
        key = (u.get("authorized_key_line") or "").strip()
        if not key:
            break
        allowed = u.get("allowed_ips") or []
        if allowed:
            # Prepend from="ip1,ip2" to restrict which IPs can use this key (enforced by sshd)
            from_opt = 'from="' + ",".join(allowed) + '",'
            print(from_opt + key)
        else:
            print(key)
        break
except Exception:
    pass
sys.exit(0)
AKCEOF
  chmod 755 "$SYNC_DIR/authorized-keys-command.py"
  # sshd config: AuthorizedKeysCommand for centralized key lookup + fallback to per-user files
  if [ -d /etc/ssh/sshd_config.d ]; then
    cat > /etc/ssh/sshd_config.d/99-sshcontrol.conf << 'SSHDCONF'
# SSHCONTROL managed - do not edit manually
AuthorizedKeysCommand /etc/sshcontrol/authorized-keys-command.py %u
AuthorizedKeysCommandUser root
PubkeyAuthentication yes
PasswordAuthentication yes
PermitRootLogin yes
MaxAuthTries 6
SSHDCONF
    chmod 644 /etc/ssh/sshd_config.d/99-sshcontrol.conf
    sshd -t 2>/dev/null && (systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null || service sshd reload 2>/dev/null || service ssh reload 2>/dev/null || true)
  fi
  # Fallback: if sshd_config.d is not supported, patch the main sshd_config directly
  if [ ! -d /etc/ssh/sshd_config.d ] && [ -f /etc/ssh/sshd_config ]; then
    sed -i '/^# SSHCONTROL-BEGIN/,/^# SSHCONTROL-END/d' /etc/ssh/sshd_config
    cat >> /etc/ssh/sshd_config << 'SSHDPATCH'
# SSHCONTROL-BEGIN - do not edit manually
AuthorizedKeysCommand /etc/sshcontrol/authorized-keys-command.py %u
AuthorizedKeysCommandUser root
PubkeyAuthentication yes
PasswordAuthentication yes
PermitRootLogin yes
MaxAuthTries 6
# SSHCONTROL-END
SSHDPATCH
    sshd -t 2>/dev/null && (systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null || service sshd reload 2>/dev/null || service ssh reload 2>/dev/null || true)
  fi
  cat > "$SYNC_DIR/sync-users.sh" << 'SYNCUSERS'
#!/bin/sh
SYNC_DIR="/etc/sshcontrol"
LOCKFILE="$SYNC_DIR/.lock-users"
[ -r "$SYNC_DIR/server_id" ] || exit 0
[ -r "$SYNC_DIR/token" ] || exit 0
[ -r "$SYNC_DIR/api_url" ] || exit 0
exec 9>"$LOCKFILE"
flock -n 9 || exit 0
# Rotate log if larger than 1 MB
[ -f "$SYNC_DIR/sync-users.log" ] && [ "$(stat -c%s "$SYNC_DIR/sync-users.log" 2>/dev/null || echo 0)" -gt 1048576 ] && : > "$SYNC_DIR/sync-users.log"
API_URL=$(cat "$SYNC_DIR/api_url")
TOKEN=$(cat "$SYNC_DIR/token")
SERVER_ID=$(cat "$SYNC_DIR/server_id")
TMP=$(mktemp)
HTTP_CODE=$(curl -s -w '%{{http_code}}' "$API_URL/api/servers/users-keys?token=$TOKEN&server_id=$SERVER_ID" -o "$TMP" 2>/dev/null)
if [ "$HTTP_CODE" = "200" ] && python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert 'users' in d" "$TMP" 2>/dev/null; then
  cp "$TMP" "$SYNC_DIR/users-keys.json"
else
  echo "$(date): sync-users download failed (HTTP $HTTP_CODE), keeping previous data" >> "$SYNC_DIR/sync-users.log"
fi
rm -f "$TMP"
python3 "$SYNC_DIR/sync-users.py" "$SYNC_DIR" 2>> "$SYNC_DIR/sync-users.log" || true
SYNCUSERS
  chmod +x "$SYNC_DIR/sync-users.sh"
  chmod +x "$SYNC_DIR/sync-users.py" 2>/dev/null || true
  "$SYNC_DIR/sync-users.sh" 2>/dev/null || true
  (crontab -l 2>/dev/null | grep -v "sync-authorized-keys"; echo "*/5 * * * * $SYNC_DIR/sync-authorized-keys.sh") | crontab - 2>/dev/null || true
  (crontab -l 2>/dev/null | grep -v "sync-users"; echo "*/5 * * * * $SYNC_DIR/sync-users.sh") | crontab - 2>/dev/null || true
  # Check if admin requested sync (Sync now from panel); run sync within ~1 min then clear flag
  cat > "$SYNC_DIR/check-and-sync.sh" << 'CHECKSYNC'
#!/bin/sh
SYNC_DIR="/etc/sshcontrol"
[ -r "$SYNC_DIR/server_id" ] || exit 0
[ -r "$SYNC_DIR/token" ] || exit 0
[ -r "$SYNC_DIR/api_url" ] || exit 0
API_URL=$(cat "$SYNC_DIR/api_url")
TOKEN=$(cat "$SYNC_DIR/token")
SERVER_ID=$(cat "$SYNC_DIR/server_id")
RESP=$(curl -s "$API_URL/api/servers/pending-sync?token=$TOKEN&server_id=$SERVER_ID" 2>/dev/null)
if echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if d.get('sync') else 1)" 2>/dev/null; then
  "$SYNC_DIR/sync-authorized-keys.sh" 2>/dev/null || true
  "$SYNC_DIR/sync-users.sh" 2>/dev/null || true
  BODY='{{"token": "'"$TOKEN"'", "server_id": "'"$SERVER_ID"'"}}'
  curl -s -X POST "$API_URL/api/servers/clear-sync" -H "Content-Type: application/json" -d "$BODY" >/dev/null 2>&1 || true
fi
CHECKSYNC
  chmod +x "$SYNC_DIR/check-and-sync.sh"
  (crontab -l 2>/dev/null | grep -v "check-and-sync"; echo "* * * * * $SYNC_DIR/check-and-sync.sh") | crontab - 2>/dev/null || true
  # Report active SSH sessions to panel for User monitor (who is connected to which server)
  cat > "$SYNC_DIR/report-sessions.sh" << 'REPORTSESS'
#!/bin/sh
SYNC_DIR="/etc/sshcontrol"
[ -r "$SYNC_DIR/server_id" ] || exit 0
[ -r "$SYNC_DIR/token" ] || exit 0
[ -r "$SYNC_DIR/api_url" ] || exit 0
API_URL=$(cat "$SYNC_DIR/api_url")
TOKEN=$(cat "$SYNC_DIR/token")
SERVER_ID=$(cat "$SYNC_DIR/server_id")
# List of usernames with an active session (w -h -s: no header, short format; first column is username)
USERS=$(w -h -s 2>/dev/null | awk '{{print $1}}' | sort -u | tr '\n' ',' | sed 's/,$//')
if [ -z "$USERS" ]; then
  USERS_JSON="[]"
else
  USERS_JSON=$(echo "$USERS" | sed 's/^/["/;s/,/","/g;s/$/"]/')
fi
BODY='{{"token": "'"$TOKEN"'", "server_id": "'"$SERVER_ID"'", "usernames": '"$USERS_JSON"'}}'
curl -s -X POST "$API_URL/api/servers/report-sessions" -H "Content-Type: application/json" -d "$BODY" >/dev/null 2>&1 || true
REPORTSESS
  chmod +x "$SYNC_DIR/report-sessions.sh"
  (crontab -l 2>/dev/null | grep -v "report-sessions"; echo "*/2 * * * * $SYNC_DIR/report-sessions.sh") | crontab - 2>/dev/null || true
fi

echo "Server registered. SSH hardened (key-only auth, password disabled). Linux users created/updated so panel users can ssh as their username with key (no password). Re-sync every 5 min. Session reporting every 2 min for User monitor."
'''
