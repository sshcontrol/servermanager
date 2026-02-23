from uuid import uuid4
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from sqlalchemy.orm import selectinload
from fastapi import HTTPException, status

from app.models import Role, Permission
from app.models.association import role_permissions
from app.schemas.role import RoleCreate, RoleUpdate


class RoleService:
    @staticmethod
    async def create_role(db: AsyncSession, data: RoleCreate) -> Role:
        existing = await db.execute(select(Role).where(Role.name == data.name))
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Role name already exists",
            )
        role = Role(
            id=str(uuid4()),
            name=data.name,
            description=data.description,
        )
        db.add(role)
        await db.flush()
        if data.permission_ids:
            for pid in data.permission_ids:
                await db.execute(role_permissions.insert().values(role_id=role.id, permission_id=pid))
        await db.refresh(role)
        return await RoleService.get_role(db, role.id)

    @staticmethod
    async def get_role(db: AsyncSession, role_id: str) -> Role | None:
        result = await db.execute(
            select(Role)
            .options(selectinload(Role.permissions))
            .where(Role.id == role_id)
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def list_roles(db: AsyncSession) -> list[Role]:
        result = await db.execute(
            select(Role)
            .options(selectinload(Role.permissions))
            .order_by(Role.name)
        )
        return list(result.scalars().all())

    @staticmethod
    async def list_permissions(db: AsyncSession) -> list[Permission]:
        result = await db.execute(select(Permission).order_by(Permission.resource, Permission.action))
        return list(result.scalars().all())

    @staticmethod
    async def update_role(db: AsyncSession, role_id: str, data: RoleUpdate) -> Role | None:
        role = await RoleService.get_role(db, role_id)
        if not role:
            return None
        if data.name is not None:
            existing = await db.execute(select(Role).where(Role.name == data.name, Role.id != role_id))
            if existing.scalar_one_or_none():
                raise HTTPException(status_code=400, detail="Role name already exists")
            role.name = data.name
        if data.description is not None:
            role.description = data.description
        if data.permission_ids is not None:
            await db.execute(delete(role_permissions).where(role_permissions.c.role_id == role_id))
            for pid in data.permission_ids:
                await db.execute(role_permissions.insert().values(role_id=role_id, permission_id=pid))
        await db.flush()
        await db.refresh(role)
        return await RoleService.get_role(db, role_id)

    @staticmethod
    async def delete_role(db: AsyncSession, role_id: str) -> bool:
        role = await RoleService.get_role(db, role_id)
        if not role:
            return False
        await db.delete(role)
        await db.flush()
        return True
