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
from app.models.association import user_roles
from app.models.role import Role
from app.models.tenant import Tenant


async def get_tenant_owner_public_key(db: AsyncSession, tenant_id: str | None) -> str | None:
    """Return the tenant owner's uploaded SSH public key, or None. Used as fallback when no platform key exists."""
    if not tenant_id:
        return None
    r = await db.execute(
        select(Tenant.owner_id).where(Tenant.id == tenant_id)
    )
    row = r.fetchone()
    if not row or not row[0]:
        return None
    owner_id = row[0]
    r2 = await db.execute(
        select(UserSSHKey.public_key)
        .where(UserSSHKey.user_id == owner_id)
        .where(UserSSHKey.public_key.isnot(None))
        .order_by(UserSSHKey.created_at.desc())
        .limit(1)
    )
    key_row = r2.fetchone()
    return key_row[0].strip() if key_row and key_row[0] else None


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
    """Register or re-register a server. If a server with the same hostname exists for this tenant, update it and return it (avoids duplicates when deploy runs multiple times)."""
    hostname_clean = (hostname or "").strip()
    if not hostname_clean:
        hostname_clean = "unknown"
    r = await db.execute(
        select(Server).where(Server.tenant_id == tenant_id, Server.hostname == hostname_clean).limit(1)
    )
    existing = r.scalar_one_or_none()
    if existing:
        existing.ip_address = ip_address or existing.ip_address
        existing.status = "active"
        await db.flush()
        return existing
    server = Server(
        id=str(uuid.uuid4()),
        hostname=hostname_clean,
        ip_address=ip_address or None,
        status="active",
        tenant_id=tenant_id,
    )
    db.add(server)
    await db.flush()
    return server


async def _get_users_with_access_to_server(db: AsyncSession, server_id: str) -> list[tuple[str, str]]:
    """Returns list of (user_id, effective_role) for all users with access to this server (direct + server groups + user groups). Role is 'root' if any source grants root else 'user'."""
    # Direct access
    r = await db.execute(
        select(ServerAccess.user_id, ServerAccess.role).where(ServerAccess.server_id == server_id)
    )
    by_user: dict[str, str] = {}
    for uid, role in r.all():
        by_user[uid] = role if role == "root" else by_user.get(uid, "user")

    # Via server groups: server is in group, user has access to group
    r2 = await db.execute(
        select(ServerGroupAccess.user_id, ServerGroupAccess.role)
        .join(server_group_servers, server_group_servers.c.server_group_id == ServerGroupAccess.server_group_id)
        .where(server_group_servers.c.server_id == server_id)
    )
    for uid, role in r2.all():
        if uid not in by_user or role == "root":
            by_user[uid] = role

    # Via user groups: user is in a group that has access to this server
    r3 = await db.execute(
        select(user_group_members.c.user_id, ServerUserGroupAccess.role)
        .join(ServerUserGroupAccess, ServerUserGroupAccess.user_group_id == user_group_members.c.user_group_id)
        .where(ServerUserGroupAccess.server_id == server_id)
    )
    for uid, role in r3.all():
        if uid not in by_user or role == "root":
            by_user[uid] = role

    return list(by_user.items())


async def get_user_effective_server_access(
    db: AsyncSession, user_id: str, tenant_id: str | None = None
) -> list[dict]:
    """Returns list of {server_id, role} for all servers the user has access to (direct + server groups + user groups). Role is root if any source grants root, else user."""
    by_server: dict[str, str] = {}
    # Direct access
    q1 = select(ServerAccess.server_id, ServerAccess.role).where(ServerAccess.user_id == user_id)
    r1 = await db.execute(q1)
    for sid, role in r1.all():
        by_server[sid] = role
    # Via server groups
    q2 = (
        select(server_group_servers.c.server_id, ServerGroupAccess.role)
        .join(ServerGroupAccess, ServerGroupAccess.server_group_id == server_group_servers.c.server_group_id)
        .where(ServerGroupAccess.user_id == user_id)
    )
    r2 = await db.execute(q2)
    for sid, role in r2.all():
        if sid not in by_server or role == "root":
            by_server[sid] = role
    # Via user groups
    q3 = (
        select(ServerUserGroupAccess.server_id, ServerUserGroupAccess.role)
        .join(user_group_members, user_group_members.c.user_group_id == ServerUserGroupAccess.user_group_id)
        .where(user_group_members.c.user_id == user_id)
    )
    r3 = await db.execute(q3)
    for sid, role in r3.all():
        if sid not in by_server or role == "root":
            by_server[sid] = role
    # Filter by tenant if specified (only include servers in tenant)
    if tenant_id is not None:
        server_ids = list(by_server.keys())
        if server_ids:
            q4 = select(Server.id).where(Server.id.in_(server_ids), Server.tenant_id == tenant_id)
            r4 = await db.execute(q4)
            allowed = {row[0] for row in r4.all()}
            by_server = {k: v for k, v in by_server.items() if k in allowed}
    return [{"server_id": sid, "role": r} for sid, r in by_server.items()]


async def list_servers(db: AsyncSession, user_id: str, is_superuser: bool, tenant_id: str | None = None) -> list[Server]:
    if is_superuser:
        q = select(Server).options(selectinload(Server.server_groups))
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
    r = await db.execute(
        select(Server)
        .options(selectinload(Server.server_groups))
        .where(Server.id.in_(server_ids))
        .order_by(Server.hostname)
    )
    return list(r.scalars().all())


async def get_my_groups_and_servers(db: AsyncSession, user_id: str, is_superuser: bool, tenant_id: str | None = None) -> dict:
    """Returns { user_groups, server_groups, servers } for the current user. servers include source (direct, server_group, user_group)."""
    from app.models.server_group import ServerGroup, ServerGroupAccess
    from app.models.user_group import UserGroup

    user_groups: list[dict] = []
    q_ug = (
        select(UserGroup.id, UserGroup.name)
        .join(user_group_members, user_group_members.c.user_group_id == UserGroup.id)
        .where(user_group_members.c.user_id == user_id)
    )
    if tenant_id is not None:
        q_ug = q_ug.where(UserGroup.tenant_id == tenant_id)
    r_ug = await db.execute(q_ug)
    for row in r_ug.all():
        user_groups.append({"id": row[0], "name": row[1]})

    server_groups: list[dict] = []
    q_sg = (
        select(ServerGroup.id, ServerGroup.name, ServerGroupAccess.role)
        .join(ServerGroupAccess, ServerGroupAccess.server_group_id == ServerGroup.id)
        .where(ServerGroupAccess.user_id == user_id)
    )
    if tenant_id is not None:
        q_sg = q_sg.where(ServerGroup.tenant_id == tenant_id)
    r_sg = await db.execute(q_sg)
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
        q2 = (
            select(server_group_servers.c.server_id, ServerGroup.name)
            .join(ServerGroupAccess, ServerGroupAccess.server_group_id == server_group_servers.c.server_group_id)
            .join(ServerGroup, ServerGroup.id == server_group_servers.c.server_group_id)
            .where(ServerGroupAccess.user_id == user_id)
        )
        if tenant_id is not None:
            q2 = q2.where(ServerGroup.tenant_id == tenant_id)
        r2 = await db.execute(q2)
        for sid, gname in r2.all():
            source_by_server.setdefault(sid, []).append(("server_group", gname))
        q3 = (
            select(ServerUserGroupAccess.server_id, UserGroup.name)
            .join(user_group_members, user_group_members.c.user_group_id == ServerUserGroupAccess.user_group_id)
            .join(UserGroup, UserGroup.id == ServerUserGroupAccess.user_group_id)
            .where(user_group_members.c.user_id == user_id)
        )
        if tenant_id is not None:
            q3 = q3.where(UserGroup.tenant_id == tenant_id)
        r3 = await db.execute(q3)
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
    r = await db.execute(
        select(Server).options(selectinload(Server.server_groups)).where(Server.id == server_id)
    )
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
    """accesses = [{"server_id": "...", "role": "root"|"user"}, ...]"""
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
    Uses platform SSH key if available; otherwise falls back to tenant owner's uploaded key.
    Individual users connect via their own Linux accounts (per-user keys managed by sync-users.py).
    """
    server = await get_server(db, server_id)
    tenant_id = server.tenant_id if server else None
    if tenant_id:
        r = await db.execute(select(PlatformSSHKey).where(PlatformSSHKey.tenant_id == tenant_id))
    else:
        r = await db.execute(select(PlatformSSHKey).where(PlatformSSHKey.tenant_id.is_(None)).limit(1))
    platform_key = r.scalar_one_or_none()
    if platform_key and platform_key.public_key:
        pk = platform_key.public_key.strip()
    else:
        pk = await get_tenant_owner_public_key(db, tenant_id)
    if not pk:
        return ""
    opts = "no-X11-forwarding,no-agent-forwarding "
    return opts + pk + "\n"


async def get_users_keys_for_server(db: AsyncSession, server_id: str) -> list[dict]:
    """
    Return list of { "username": str, "authorized_key_line": str, "allowed_ips": list[str] } for each user with access and a key.
    allowed_ips: when IP whitelist is enabled, only these IPs can SSH as this user to the server; empty = no restriction.
    Includes access via direct, server group, user group, and tenant admins (superusers).
    """
    from app.services import security_service

    server = await get_server(db, server_id)
    tenant_id = server.tenant_id if server else None
    user_roles_list = await _get_users_with_access_to_server(db, server_id)
    existing_ids = {uid for uid, _ in user_roles_list}
    # Include tenant admins (is_superuser OR admin role) with root/sudo on all servers in their tenant
    if tenant_id:
        admin_role_ids = select(Role.id).where(Role.name == "admin")
        r_admin = await db.execute(
            select(User.id).where(
                User.tenant_id == tenant_id,
                User.is_active == True,  # noqa: E712
                (
                    (User.is_superuser == True)  # noqa: E712
                    | (User.id.in_(select(user_roles.c.user_id).where(user_roles.c.role_id.in_(admin_role_ids))))
                ),
            )
        )
        for (uid,) in r_admin.all():
            if uid not in existing_ids:
                user_roles_list.append((uid, "root"))
                existing_ids.add(uid)
    if not user_roles_list:
        return []
    user_ids = [uid for uid, _ in user_roles_list]
    allowed_per_user = await security_service.get_allowed_ips_per_user(db, user_ids, tenant_id=tenant_id)
    role_by_user = dict(user_roles_list)
    r = await db.execute(
        select(User, UserSSHKey)
        .outerjoin(UserSSHKey, User.id == UserSSHKey.user_id)
        .where(User.id.in_(user_ids))
        .where(User.is_active == True)  # noqa: E712
        .order_by(User.id, UserSSHKey.created_at.desc().nulls_last())
    )
    seen_user: set[str] = set()
    # Options must be comma-separated with NO spaces; space before key type causes sshd to reject
    opts = "no-X11-forwarding,no-agent-forwarding"
    result: list[dict] = []
    for user, ssh_key in r.all():
        if not ssh_key or not ssh_key.public_key or user.id in seen_user:
            continue
        seen_user.add(user.id)
        pk = ssh_key.public_key.strip()
        # Per-user 2FA: only add 2fa-gate for users who have TOTP enabled. Users with 2FA disabled connect directly.
        totp_on = bool(getattr(user, "totp_enabled", False))
        line = opts + " " + pk
        if totp_on:
            line = 'command="/etc/sshcontrol/2fa-gate",' + opts + " " + pk
        safe_name = re.sub(r"[^a-z0-9_]", "_", (user.username or "user").lower()).strip("_") or "user"
        allowed_ips = allowed_per_user.get(user.id, [])
        role = role_by_user.get(user.id, "user")
        # Output "admin" for root users so old sync scripts (checking role == "admin") work without redeploy
        role_for_sync = "admin" if role == "root" else role
        result.append({
            "username": safe_name,
            "authorized_key_line": line,
            "allowed_ips": allowed_ips,
            "role": role_for_sync,
            "totp_required": totp_on,
        })
    return result


def _linux_username(panel_username: str) -> str:
    """Same sanitization as in get_users_keys_for_server: panel username -> Linux username on server."""
    return re.sub(r"[^a-z0-9_]", "_", (panel_username or "user").lower()).strip("_") or "user"


async def get_user_by_linux_username(db: AsyncSession, linux_username: str) -> User | None:
    """Find User whose panel username maps to the given Linux username. Used for SSH 2FA verification."""
    target = (linux_username or "").strip().lower()
    if not target:
        return None
    r = await db.execute(select(User).where(User.is_active == True))  # noqa: E712
    for user in r.scalars().all():
        if _linux_username(user.username or "") == target:
            return user
    return None


async def get_user_by_linux_username_for_server(
    db: AsyncSession, server_id: str, linux_username: str
) -> User | None:
    """Find User whose panel username maps to linux_username AND who has access to this server.
    Used for SSH 2FA verification - must verify TOTP of the connecting user, not admins or other users."""
    target = (linux_username or "").strip().lower()
    if not target:
        return None
    user_roles_list = await _get_users_with_access_to_server(db, server_id)
    existing_ids = {uid for uid, _ in user_roles_list}
    server = await get_server(db, server_id)
    tenant_id = server.tenant_id if server else None
    # Include tenant admins (same as get_users_keys_for_server)
    if tenant_id:
        admin_role_ids = select(Role.id).where(Role.name == "admin")
        r_admin = await db.execute(
            select(User.id).where(
                User.tenant_id == tenant_id,
                User.is_active == True,  # noqa: E712
                (
                    (User.is_superuser == True)  # noqa: E712
                    | (User.id.in_(select(user_roles.c.user_id).where(user_roles.c.role_id.in_(admin_role_ids))))
                ),
            )
        )
        for (uid,) in r_admin.all():
            existing_ids.add(uid)
    if not existing_ids:
        return None
    r = await db.execute(
        select(User).where(User.id.in_(existing_ids)).where(User.is_active == True)  # noqa: E712
    )
    for user in r.scalars().all():
        if _linux_username(user.username or "") == target:
            return user
    return None


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
