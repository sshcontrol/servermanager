"""Server groups: CRUD and assign servers/users with role."""

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
import uuid

from app.models.server import Server
from app.models.server_group import ServerGroup, ServerGroupAccess, server_group_servers
from app.models.user import User


def _server_group_to_item(sg: ServerGroup) -> dict:
    return {
        "id": sg.id,
        "name": sg.name,
        "description": sg.description or "",
        "created_at": sg.created_at.isoformat(),
    }


async def list_server_groups(db: AsyncSession) -> list[dict]:
    r = await db.execute(select(ServerGroup).order_by(ServerGroup.name))
    return [_server_group_to_item(sg) for sg in r.scalars().all()]


async def get_server_group(db: AsyncSession, group_id: str) -> ServerGroup | None:
    r = await db.execute(
        select(ServerGroup)
        .options(
            selectinload(ServerGroup.servers),
            selectinload(ServerGroup.access).selectinload(ServerGroupAccess.user),
        )
        .where(ServerGroup.id == group_id)
    )
    return r.scalar_one_or_none()


async def create_server_group(db: AsyncSession, name: str, description: str | None = None) -> ServerGroup:
    sg = ServerGroup(
        id=str(uuid.uuid4()),
        name=name.strip(),
        description=description.strip() if description else None,
    )
    db.add(sg)
    await db.flush()
    return sg


async def update_server_group(db: AsyncSession, group_id: str, name: str | None = None, description: str | None = None) -> ServerGroup | None:
    sg = await get_server_group(db, group_id)
    if not sg:
        return None
    if name is not None:
        sg.name = name.strip()
    if description is not None:
        sg.description = description.strip() or None
    await db.flush()
    return sg


async def delete_server_group(db: AsyncSession, group_id: str) -> bool:
    r = await db.execute(select(ServerGroup).where(ServerGroup.id == group_id))
    sg = r.scalar_one_or_none()
    if not sg:
        return False
    await db.delete(sg)
    await db.flush()
    return True


async def add_server_to_group(db: AsyncSession, group_id: str, server_id: str) -> bool:
    sg = await get_server_group(db, group_id)
    if not sg:
        return False
    server = await db.get(Server, server_id)
    if not server:
        return False
    if server not in sg.servers:
        sg.servers.append(server)
        await db.flush()
    return True


async def remove_server_from_group(db: AsyncSession, group_id: str, server_id: str) -> bool:
    await db.execute(
        delete(server_group_servers).where(
            server_group_servers.c.server_group_id == group_id,
            server_group_servers.c.server_id == server_id,
        )
    )
    await db.flush()
    return True


async def list_group_servers(db: AsyncSession, group_id: str) -> list[dict]:
    sg = await get_server_group(db, group_id)
    if not sg:
        return []
    return [
        {"id": s.id, "hostname": s.hostname, "friendly_name": getattr(s, "friendly_name", None), "ip_address": s.ip_address}
        for s in sg.servers
    ]


async def list_group_access(db: AsyncSession, group_id: str) -> list[dict]:
    r = await db.execute(
        select(ServerGroupAccess, User.username)
        .join(User, User.id == ServerGroupAccess.user_id)
        .where(ServerGroupAccess.server_group_id == group_id)
    )
    return [{"user_id": row[0].user_id, "username": row[1], "role": row[0].role} for row in r.all()]


async def set_group_user_access(db: AsyncSession, group_id: str, user_id: str, role: str) -> bool:
    sg = await get_server_group(db, group_id)
    if not sg:
        return False
    await db.execute(
        delete(ServerGroupAccess).where(
            ServerGroupAccess.server_group_id == group_id,
            ServerGroupAccess.user_id == user_id,
        )
    )
    db.add(ServerGroupAccess(server_group_id=group_id, user_id=user_id, role=role))
    await db.flush()
    return True


async def remove_group_user_access(db: AsyncSession, group_id: str, user_id: str) -> bool:
    await db.execute(
        delete(ServerGroupAccess).where(
            ServerGroupAccess.server_group_id == group_id,
            ServerGroupAccess.user_id == user_id,
        )
    )
    await db.flush()
    return True
