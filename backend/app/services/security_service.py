"""Security: IP whitelist settings and enforcement (per-tenant)."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.security import IpWhitelistSettings, IpWhitelistEntry


async def _get_settings_row(db: AsyncSession, tenant_id: str | None) -> IpWhitelistSettings | None:
    """Get the whitelist settings row for a specific tenant."""
    if tenant_id:
        r = await db.execute(
            select(IpWhitelistSettings).where(IpWhitelistSettings.tenant_id == tenant_id)
        )
    else:
        r = await db.execute(
            select(IpWhitelistSettings).where(IpWhitelistSettings.tenant_id.is_(None)).limit(1)
        )
    return r.scalar_one_or_none()


async def get_whitelist_enabled(db: AsyncSession, tenant_id: str | None = None) -> bool:
    """Return whether IP whitelist is enabled for this tenant."""
    row = await _get_settings_row(db, tenant_id)
    return row.enabled if row else False


async def set_whitelist_enabled(db: AsyncSession, enabled: bool, tenant_id: str | None = None) -> bool:
    """Set IP whitelist on/off for a tenant. Creates settings row if needed."""
    row = await _get_settings_row(db, tenant_id)
    if not row:
        from app.models.security import generate_uuid
        row = IpWhitelistSettings(id=generate_uuid(), tenant_id=tenant_id, enabled=enabled)
        db.add(row)
        await db.flush()
        return row.enabled
    row.enabled = enabled
    await db.flush()
    return row.enabled


async def get_allowed_ips_per_user(db: AsyncSession, user_ids: list[str], tenant_id: str | None = None) -> dict[str, list[str]]:
    """
    Return for each user_id the list of IPs allowed to SSH as that user.
    Scoped to the tenant owning the server.
    """
    enabled = await get_whitelist_enabled(db, tenant_id)
    if not enabled or not user_ids:
        return {}

    q = select(IpWhitelistEntry.ip_address, IpWhitelistEntry.scope, IpWhitelistEntry.user_id).where(
        (IpWhitelistEntry.scope == "all") | (IpWhitelistEntry.user_id.in_(user_ids)),
    )
    if tenant_id:
        q = q.where(IpWhitelistEntry.tenant_id == tenant_id)
    else:
        q = q.where(IpWhitelistEntry.tenant_id.is_(None))

    r = await db.execute(q)
    rows = r.all()

    all_ips: list[str] = []
    per_user: dict[str, list[str]] = {uid: [] for uid in user_ids}
    for ip_address, scope, user_id in rows:
        ip = (ip_address or "").strip()
        if not ip:
            continue
        if scope == "all":
            if ip not in all_ips:
                all_ips.append(ip)
        elif scope == "user" and user_id and user_id in per_user and ip not in per_user[user_id]:
            per_user[user_id].append(ip)

    result: dict[str, list[str]] = {}
    for uid in user_ids:
        combined = list(all_ips) + list(per_user[uid])
        result[uid] = combined
    return result


async def list_whitelist_entries(db: AsyncSession, tenant_id: str | None = None):
    """Return list of whitelist entries scoped to tenant."""
    from app.models.user import User

    q = (
        select(IpWhitelistEntry, User.username)
        .outerjoin(User, IpWhitelistEntry.user_id == User.id)
    )
    if tenant_id:
        q = q.where(IpWhitelistEntry.tenant_id == tenant_id)
    else:
        q = q.where(IpWhitelistEntry.tenant_id.is_(None))

    r = await db.execute(q.order_by(IpWhitelistEntry.created_at.desc()))
    rows = r.all()
    return [
        {
            "id": e.id,
            "ip_address": e.ip_address,
            "scope": e.scope,
            "user_id": e.user_id,
            "username": username,
        }
        for e, username in rows
    ]


async def add_whitelist_entry(
    db: AsyncSession, ip_address: str, scope: str, user_id: str | None = None, tenant_id: str | None = None
) -> IpWhitelistEntry:
    """Add a whitelist entry scoped to tenant."""
    entry = IpWhitelistEntry(
        ip_address=ip_address.strip(),
        scope=scope,
        user_id=user_id if scope == "user" else None,
        tenant_id=tenant_id,
    )
    db.add(entry)
    await db.flush()
    return entry


async def update_whitelist_entry(
    db: AsyncSession, entry_id: str, ip_address: str | None = None, scope: str | None = None, user_id: str | None = None,
    tenant_id: str | None = None,
) -> IpWhitelistEntry | None:
    """Update an entry. Validates tenant ownership."""
    q = select(IpWhitelistEntry).where(IpWhitelistEntry.id == entry_id)
    if tenant_id:
        q = q.where(IpWhitelistEntry.tenant_id == tenant_id)
    r = await db.execute(q)
    entry = r.scalar_one_or_none()
    if not entry:
        return None
    if ip_address is not None:
        entry.ip_address = ip_address.strip()
    if scope is not None:
        entry.scope = scope
        entry.user_id = user_id if scope == "user" else None
    elif user_id is not None and entry.scope == "user":
        entry.user_id = user_id
    await db.flush()
    return entry


async def delete_whitelist_entry(db: AsyncSession, entry_id: str, tenant_id: str | None = None) -> bool:
    """Remove a whitelist entry. Validates tenant ownership."""
    q = select(IpWhitelistEntry).where(IpWhitelistEntry.id == entry_id)
    if tenant_id:
        q = q.where(IpWhitelistEntry.tenant_id == tenant_id)
    r = await db.execute(q)
    entry = r.scalar_one_or_none()
    if not entry:
        return False
    await db.delete(entry)
    await db.flush()
    return True
