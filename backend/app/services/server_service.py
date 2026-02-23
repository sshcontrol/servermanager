from sqlalchemy import select, delete, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.sql import literal_column
import hmac
import re
import uuid
import asyncio
import json
from datetime import datetime, timezone, timedelta

from app.models.server import Server, ServerAccess, ServerSessionReport
from app.models.server_group import ServerGroup, ServerGroupAccess, server_group_servers
from app.models.user_group import UserGroup, ServerUserGroupAccess, user_group_members
from app.models.deployment import DeploymentToken
from app.models.user import User
from app.models.ssh_key import UserSSHKey
from app.models.platform_key import PlatformSSHKey


async def get_deployment_token(db: AsyncSession, tenant_id: str | None = None) -> str | None:
    if tenant_id:
        r = await db.execute(select(DeploymentToken).where(DeploymentToken.tenant_id == tenant_id))
    else:
        r = await db.execute(select(DeploymentToken).where(DeploymentToken.tenant_id.is_(None)).limit(1))
    row = r.scalar_one_or_none()
    return row.token if row else None


async def verify_deployment_token(db: AsyncSession, token: str) -> DeploymentToken | None:
    """Verify token and return the DeploymentToken row (contains tenant_id)."""
    r = await db.execute(select(DeploymentToken).where(DeploymentToken.token == token))
    row = r.scalar_one_or_none()
    if not row:
        return None
    if not hmac.compare_digest(row.token, token):
        return None
    return row


async def register_server(db: AsyncSession, hostname: str, ip_address: str | None, tenant_id: str | None = None) -> Server:
    server = Server(
        id=str(uuid.uuid4()),
        hostname=hostname,
        ip_address=ip_address or None,
        status="active",
        tenant_id=tenant_id,
    )
    db.add(server)
    await db.flush()
    return server


async def _get_users_with_access_to_server(db: AsyncSession, server_id: str) -> list[tuple[str, str]]:
    """Returns list of (user_id, effective_role) for all users with access to this server (direct + server groups + user groups). Role is 'admin' if any source grants admin else 'user'."""
    # Direct access
    r = await db.execute(
        select(ServerAccess.user_id, ServerAccess.role).where(ServerAccess.server_id == server_id)
    )
    by_user: dict[str, str] = {}
    for uid, role in r.all():
        by_user[uid] = role if role == "admin" else by_user.get(uid, "user")

    # Via server groups: server is in group, user has access to group
    r2 = await db.execute(
        select(ServerGroupAccess.user_id, ServerGroupAccess.role)
        .join(server_group_servers, server_group_servers.c.server_group_id == ServerGroupAccess.server_group_id)
        .where(server_group_servers.c.server_id == server_id)
    )
    for uid, role in r2.all():
        if uid not in by_user or role == "admin":
            by_user[uid] = role

    # Via user groups: user is in a group that has access to this server
    r3 = await db.execute(
        select(user_group_members.c.user_id, ServerUserGroupAccess.role)
        .join(ServerUserGroupAccess, ServerUserGroupAccess.user_group_id == user_group_members.c.user_group_id)
        .where(ServerUserGroupAccess.server_id == server_id)
    )
    for uid, role in r3.all():
        if uid not in by_user or role == "admin":
            by_user[uid] = role

    return list(by_user.items())


async def list_servers(db: AsyncSession, user_id: str, is_superuser: bool, tenant_id: str | None = None) -> list[Server]:
    if is_superuser:
        q = select(Server)
        if tenant_id:
            q = q.where(Server.tenant_id == tenant_id)
        r = await db.execute(q.order_by(Server.hostname))
        return list(r.scalars().all())
    # Collect server IDs from direct access, server groups, and user groups
    server_ids: set[str] = set()
    r1 = await db.execute(select(ServerAccess.server_id).where(ServerAccess.user_id == user_id))
    server_ids.update(row[0] for row in r1.all())
    r2 = await db.execute(
        select(server_group_servers.c.server_id)
        .join(ServerGroupAccess, ServerGroupAccess.server_group_id == server_group_servers.c.server_group_id)
        .where(ServerGroupAccess.user_id == user_id)
    )
    server_ids.update(row[0] for row in r2.all())
    r3 = await db.execute(
        select(ServerUserGroupAccess.server_id)
        .join(user_group_members, user_group_members.c.user_group_id == ServerUserGroupAccess.user_group_id)
        .where(user_group_members.c.user_id == user_id)
    )
    server_ids.update(row[0] for row in r3.all())
    if not server_ids:
        return []
    r = await db.execute(select(Server).where(Server.id.in_(server_ids)).order_by(Server.hostname))
    return list(r.scalars().all())


async def get_my_groups_and_servers(db: AsyncSession, user_id: str, is_superuser: bool, tenant_id: str | None = None) -> dict:
    """Returns { user_groups, server_groups, servers } for the current user. servers include source (direct, server_group, user_group)."""
    from app.models.server_group import ServerGroup, ServerGroupAccess
    from app.models.user_group import UserGroup

    user_groups: list[dict] = []
    r_ug = await db.execute(
        select(UserGroup.id, UserGroup.name)
        .join(user_group_members, user_group_members.c.user_group_id == UserGroup.id)
        .where(user_group_members.c.user_id == user_id)
    )
    for row in r_ug.all():
        user_groups.append({"id": row[0], "name": row[1]})

    server_groups: list[dict] = []
    r_sg = await db.execute(
        select(ServerGroup.id, ServerGroup.name, ServerGroupAccess.role)
        .join(ServerGroupAccess, ServerGroupAccess.server_group_id == ServerGroup.id)
        .where(ServerGroupAccess.user_id == user_id)
    )
    for row in r_sg.all():
        server_groups.append({"id": row[0], "name": row[1], "role": row[2]})

    if is_superuser:
        servers_list = await list_servers(db, user_id, True, tenant_id=tenant_id)
        servers = [
            {
                "id": s.id,
                "hostname": s.hostname,
                "friendly_name": getattr(s, "friendly_name", None),
                "ip_address": s.ip_address,
                "source": "admin",
                "source_name": None,
            }
            for s in servers_list
        ]
    else:
        servers_list = await list_servers(db, user_id, False)
        # Build source for each server: direct, server_group:name, user_group:name (one label per server)
        source_by_server: dict[str, list[tuple[str, str | None]]] = {}
        r1 = await db.execute(select(ServerAccess.server_id).where(ServerAccess.user_id == user_id))
        for (sid,) in r1.all():
            source_by_server.setdefault(sid, []).append(("direct", None))
        r2 = await db.execute(
            select(server_group_servers.c.server_id, ServerGroup.name)
            .join(ServerGroupAccess, ServerGroupAccess.server_group_id == server_group_servers.c.server_group_id)
            .join(ServerGroup, ServerGroup.id == server_group_servers.c.server_group_id)
            .where(ServerGroupAccess.user_id == user_id)
        )
        for sid, gname in r2.all():
            source_by_server.setdefault(sid, []).append(("server_group", gname))
        r3 = await db.execute(
            select(ServerUserGroupAccess.server_id, UserGroup.name)
            .join(user_group_members, user_group_members.c.user_group_id == ServerUserGroupAccess.user_group_id)
            .join(UserGroup, UserGroup.id == ServerUserGroupAccess.user_group_id)
            .where(user_group_members.c.user_id == user_id)
        )
        for sid, gname in r3.all():
            source_by_server.setdefault(sid, []).append(("user_group", gname))
        servers = []
        for s in servers_list:
            sources = source_by_server.get(s.id, [("direct", None)])
            kind, name = sources[0] if len(sources) == 1 else next((x for x in sources if x[0] != "direct"), sources[0])
            servers.append({
                "id": s.id,
                "hostname": s.hostname,
                "friendly_name": getattr(s, "friendly_name", None),
                "ip_address": s.ip_address,
                "source": kind,
                "source_name": name,
            })
    return {"user_groups": user_groups, "server_groups": server_groups, "servers": servers}


async def get_server(db: AsyncSession, server_id: str) -> Server | None:
    r = await db.execute(select(Server).where(Server.id == server_id))
    return r.scalar_one_or_none()


async def delete_server(db: AsyncSession, server_id: str) -> bool:
    """Delete server (cascades to server_access). Returns True if deleted."""
    server = await get_server(db, server_id)
    if not server:
        return False
    await db.delete(server)
    await db.flush()
    return True


async def get_server_with_access(db: AsyncSession, server_id: str):
    r = await db.execute(
        select(Server).options(selectinload(Server.accesses)).where(Server.id == server_id)
    )
    server = r.scalar_one_or_none()
    if not server:
        return None, []
    return server, list(server.accesses)


async def set_server_access(db: AsyncSession, server_id: str, user_id: str, role: str) -> None:
    await db.execute(
        delete(ServerAccess).where(
            ServerAccess.server_id == server_id,
            ServerAccess.user_id == user_id,
        )
    )
    db.add(ServerAccess(server_id=server_id, user_id=user_id, role=role))
    await db.flush()


async def set_user_server_accesses(db: AsyncSession, user_id: str, accesses: list[dict]) -> None:
    """accesses = [{"server_id": "...", "role": "admin"|"user"}, ...]"""
    await db.execute(delete(ServerAccess).where(ServerAccess.user_id == user_id))
    for a in accesses:
        db.add(ServerAccess(user_id=user_id, server_id=a["server_id"], role=a["role"]))
    await db.flush()


async def list_server_access(db: AsyncSession, server_id: str) -> list[dict]:
    """Returns list of { user_id, username, role, source } for users who have access (direct, server_group, user_group)."""
    user_roles = await _get_users_with_access_to_server(db, server_id)
    if not user_roles:
        return []
    user_ids = [uid for uid, _ in user_roles]
    role_by_user = dict(user_roles)
    r = await db.execute(select(User.id, User.username).where(User.id.in_(user_ids)))
    users = {row[0]: row[1] for row in r.all()}
    return [
        {"user_id": uid, "username": users.get(uid, ""), "role": role_by_user[uid], "source": "computed"}
        for uid in user_ids
    ]


async def remove_server_access(db: AsyncSession, server_id: str, user_id: str) -> None:
    await db.execute(
        delete(ServerAccess).where(
            ServerAccess.server_id == server_id,
            ServerAccess.user_id == user_id,
        )
    )
    await db.flush()


async def set_sync_requested(db: AsyncSession, server_id: str) -> bool:
    """Set sync_requested_at to now for this server. Returns True if server exists."""
    server = await get_server(db, server_id)
    if not server:
        return False
    server.sync_requested_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.flush()
    return True


async def get_pending_sync(db: AsyncSession, server_id: str) -> bool:
    """Return True if sync was requested for this server (server calls this to know whether to run sync)."""
    server = await get_server(db, server_id)
    return server is not None and server.sync_requested_at is not None


async def clear_sync_requested(db: AsyncSession, server_id: str) -> None:
    """Clear sync_requested_at after server has run sync."""
    server = await get_server(db, server_id)
    if server:
        server.sync_requested_at = None
        await db.flush()


async def check_server_connection(server: Server) -> tuple[str, str]:
    """Returns (status, checked_at). status is 'reachable', 'unreachable', or 'unknown' (no host to check)."""
    host = (server.ip_address or "").strip() or (server.hostname or "").strip()
    if not host:
        return "unknown", datetime.now(timezone.utc).isoformat()
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, 22),
            timeout=10.0,
        )
        writer.close()
        await writer.wait_closed()
        return "reachable", datetime.now(timezone.utc).isoformat()
    except Exception:
        return "unreachable", datetime.now(timezone.utc).isoformat()


async def get_authorized_keys_content(db: AsyncSession, server_id: str) -> str:
    """
    Build authorized_keys file content for root on this server.
    Only includes the platform SSH key (admin management key).
    Individual users connect via their own Linux accounts (per-user keys managed by sync-users.py).
    This prevents all panel users from getting unintended root SSH access.
    """
    server = await get_server(db, server_id)
    tenant_id = server.tenant_id if server else None
    if tenant_id:
        r = await db.execute(select(PlatformSSHKey).where(PlatformSSHKey.tenant_id == tenant_id))
    else:
        r = await db.execute(select(PlatformSSHKey).where(PlatformSSHKey.tenant_id.is_(None)).limit(1))
    platform_key = r.scalar_one_or_none()
    if not platform_key or not platform_key.public_key:
        return ""
    pk = platform_key.public_key.strip()
    opts = "no-port-forwarding,no-X11-forwarding,no-agent-forwarding "
    return opts + pk + "\n"


async def get_users_keys_for_server(db: AsyncSession, server_id: str) -> list[dict]:
    """
    Return list of { "username": str, "authorized_key_line": str, "allowed_ips": list[str] } for each user with access and a key.
    allowed_ips: when IP whitelist is enabled, only these IPs can SSH as this user to the server; empty = no restriction.
    Includes access via direct, server group, and user group.
    """
    from app.services import security_service

    server = await get_server(db, server_id)
    tenant_id = server.tenant_id if server else None
    user_roles = await _get_users_with_access_to_server(db, server_id)
    if not user_roles:
        return []
    user_ids = [uid for uid, _ in user_roles]
    allowed_per_user = await security_service.get_allowed_ips_per_user(db, user_ids, tenant_id=tenant_id)
    role_by_user = dict(user_roles)
    r = await db.execute(
        select(User, UserSSHKey)
        .outerjoin(UserSSHKey, User.id == UserSSHKey.user_id)
        .where(User.id.in_(user_ids))
        .where(User.is_active == True)  # noqa: E712
        .order_by(User.id, UserSSHKey.created_at.desc().nulls_last())
    )
    seen_user: set[str] = set()
    opts = "no-port-forwarding,no-X11-forwarding,no-agent-forwarding "
    result: list[dict] = []
    for user, ssh_key in r.all():
        if not ssh_key or not ssh_key.public_key or user.id in seen_user:
            continue
        seen_user.add(user.id)
        pk = ssh_key.public_key.strip()
        line = opts + pk
        safe_name = re.sub(r"[^a-z0-9_]", "_", (user.username or "user").lower()).strip("_") or "user"
        allowed_ips = allowed_per_user.get(user.id, [])
        role = role_by_user.get(user.id, "user")
        result.append({"username": safe_name, "authorized_key_line": line, "allowed_ips": allowed_ips, "role": role})
    return result


def _linux_username(panel_username: str) -> str:
    """Same sanitization as in get_users_keys_for_server: panel username -> Linux username on server."""
    return re.sub(r"[^a-z0-9_]", "_", (panel_username or "user").lower()).strip("_") or "user"


async def save_session_report(db: AsyncSession, server_id: str, usernames: list[str]) -> None:
    """Store the list of Linux usernames currently logged in on this server (called by server cron)."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    r = await db.execute(select(ServerSessionReport).where(ServerSessionReport.server_id == server_id))
    row = r.scalar_one_or_none()
    data = json.dumps(usernames)
    if row:
        row.reported_at = now
        row.usernames = data
    else:
        db.add(ServerSessionReport(server_id=server_id, reported_at=now, usernames=data))
    await db.flush()


async def get_recent_session_reports(db: AsyncSession, within_minutes: int = 3) -> dict[str, set[str]]:
    """Returns server_id -> set of Linux usernames that have an active session (from reports updated within last N min)."""
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=within_minutes)
    r = await db.execute(
        select(ServerSessionReport).where(ServerSessionReport.reported_at >= since)
    )
    out: dict[str, set[str]] = {}
    for row in r.scalars().all():
        try:
            names = json.loads(row.usernames)
            out[row.server_id] = set(names) if isinstance(names, list) else set()
        except (json.JSONDecodeError, TypeError):
            out[row.server_id] = set()
    return out
