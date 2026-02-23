"""User groups: CRUD, members, and assign group to server with role."""

from sqlalchemy import select, delete, insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
import uuid

from app.models.server import Server
from app.models.user import User
from app.models.user_group import UserGroup, ServerUserGroupAccess, user_group_members


def _user_group_to_item(ug: UserGroup) -> dict:
    return {
        "id": ug.id,
        "name": ug.name,
        "description": ug.description or "",
        "created_at": ug.created_at.isoformat(),
    }


async def list_user_groups(db: AsyncSession) -> list[dict]:
    r = await db.execute(select(UserGroup).order_by(UserGroup.name))
    return [_user_group_to_item(ug) for ug in r.scalars().all()]


async def get_user_group(db: AsyncSession, group_id: str) -> UserGroup | None:
    r = await db.execute(
        select(UserGroup)
        .options(selectinload(UserGroup.members), selectinload(UserGroup.server_accesses))
        .where(UserGroup.id == group_id)
    )
    return r.scalar_one_or_none()


async def create_user_group(db: AsyncSession, name: str, description: str | None = None) -> UserGroup:
    ug = UserGroup(
        id=str(uuid.uuid4()),
        name=name.strip(),
        description=description.strip() if description else None,
    )
    db.add(ug)
    await db.flush()
    return ug


async def update_user_group(db: AsyncSession, group_id: str, name: str | None = None, description: str | None = None) -> UserGroup | None:
    ug = await get_user_group(db, group_id)
    if not ug:
        return None
    if name is not None:
        ug.name = name.strip()
    if description is not None:
        ug.description = description.strip() or None
    await db.flush()
    return ug


async def delete_user_group(db: AsyncSession, group_id: str) -> bool:
    r = await db.execute(select(UserGroup).where(UserGroup.id == group_id))
    ug = r.scalar_one_or_none()
    if not ug:
        return False
    await db.delete(ug)
    await db.flush()
    return True


async def add_member(db: AsyncSession, group_id: str, user_id: str) -> bool:
    ug = await get_user_group(db, group_id)
    if not ug:
        return False
    user = await db.get(User, user_id)
    if not user:
        return False
    r = await db.execute(
        select(user_group_members).where(
            user_group_members.c.user_group_id == group_id,
            user_group_members.c.user_id == user_id,
        )
    )
    if r.first():
        return True
    await db.execute(insert(user_group_members).values(user_group_id=group_id, user_id=user_id))
    await db.flush()
    return True


async def remove_member(db: AsyncSession, group_id: str, user_id: str) -> bool:
    await db.execute(
        delete(user_group_members).where(
            user_group_members.c.user_group_id == group_id,
            user_group_members.c.user_id == user_id,
        )
    )
    await db.flush()
    return True


async def list_members(db: AsyncSession, group_id: str) -> list[dict]:
    r = await db.execute(
        select(User.id, User.username, User.email)
        .join(user_group_members, user_group_members.c.user_id == User.id)
        .where(user_group_members.c.user_group_id == group_id)
    )
    return [{"user_id": row[0], "username": row[1], "email": row[2]} for row in r.all()]


async def set_server_user_group_access(db: AsyncSession, server_id: str, user_group_id: str, role: str) -> bool:
    server = await db.get(Server, server_id)
    ug = await get_user_group(db, user_group_id)
    if not server or not ug:
        return False
    await db.execute(
        delete(ServerUserGroupAccess).where(
            ServerUserGroupAccess.server_id == server_id,
            ServerUserGroupAccess.user_group_id == user_group_id,
        )
    )
    db.add(ServerUserGroupAccess(server_id=server_id, user_group_id=user_group_id, role=role))
    await db.flush()
    return True


async def remove_server_user_group_access(db: AsyncSession, server_id: str, user_group_id: str) -> bool:
    await db.execute(
        delete(ServerUserGroupAccess).where(
            ServerUserGroupAccess.server_id == server_id,
            ServerUserGroupAccess.user_group_id == user_group_id,
        )
    )
    await db.flush()
    return True


async def list_user_group_servers(db: AsyncSession, group_id: str) -> list[str]:
    """Return server IDs that this user group has access to."""
    r = await db.execute(
        select(ServerUserGroupAccess.server_id).where(
            ServerUserGroupAccess.user_group_id == group_id
        )
    )
    return [row[0] for row in r.all()]


async def list_server_user_groups(db: AsyncSession, server_id: str) -> list[dict]:
    r = await db.execute(
        select(ServerUserGroupAccess, UserGroup.name)
        .join(UserGroup, UserGroup.id == ServerUserGroupAccess.user_group_id)
        .where(ServerUserGroupAccess.server_id == server_id)
    )
    return [
        {"user_group_id": row[0].user_group_id, "name": row[1], "role": row[0].role}
        for row in r.all()
    ]
