from datetime import datetime, timedelta, timezone
from uuid import uuid4
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from sqlalchemy.orm import selectinload
from fastapi import HTTPException, status

from app.models import User, Role
from app.models.association import user_roles
from app.schemas.user import UserCreate, UserUpdate
from app.core.security import get_password_hash
from app.services import server_service, user_key_service


class UserService:
    @staticmethod
    async def create_user(db: AsyncSession, data: UserCreate, tenant_id: str | None = None) -> User:
        existing = await db.execute(
            select(User).where(
                (User.email == data.email) | (User.username == data.username)
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email or username already registered",
            )
        user = User(
            id=str(uuid4()),
            email=data.email,
            username=data.username,
            phone=data.phone,
            hashed_password=get_password_hash(data.password),
            is_active=True,
            is_superuser=False,
            tenant_id=tenant_id,
            email_verified=True,
        )
        db.add(user)
        await db.flush()
        if data.role_ids:
            await UserService._assign_roles(db, user.id, data.role_ids)
        if data.server_access:
            accesses = [{"server_id": a.server_id, "role": a.role} for a in data.server_access]
            await server_service.set_user_server_accesses(db, user.id, accesses)
            await user_key_service.ensure_user_has_ssh_key(db, user.id)
            for a in accesses:
                await server_service.set_sync_requested(db, a["server_id"])
        await db.refresh(user)
        result = await db.execute(
            select(User)
            .options(selectinload(User.roles), selectinload(User.server_accesses))
            .where(User.id == user.id)
        )
        return result.scalar_one()

    @staticmethod
    async def _assign_roles(db: AsyncSession, user_id: str, role_ids: list[str]) -> None:
        await db.execute(delete(user_roles).where(user_roles.c.user_id == user_id))
        for rid in role_ids:
            await db.execute(
                user_roles.insert().values(user_id=user_id, role_id=rid)
            )

    @staticmethod
    async def get_user(db: AsyncSession, user_id: str) -> User | None:
        result = await db.execute(
            select(User)
            .options(selectinload(User.roles), selectinload(User.server_accesses))
            .where(User.id == user_id)
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def get_user_by_username(db: AsyncSession, username: str) -> User | None:
        result = await db.execute(
            select(User)
            .options(selectinload(User.roles), selectinload(User.server_accesses))
            .where(User.username == username)
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def list_users(
        db: AsyncSession,
        skip: int = 0,
        limit: int = 50,
        tenant_id: str | None = None,
        exclude_admins: bool = False,
    ) -> tuple[list[User], int]:
        base = select(User)
        count_base = select(func.count()).select_from(User)
        if tenant_id:
            base = base.where(User.tenant_id == tenant_id)
            count_base = count_base.where(User.tenant_id == tenant_id)
        if exclude_admins:
            admin_role_ids = select(Role.id).where(Role.name == "admin")
            admin_filter = (
                (User.is_superuser == False)  # noqa: E712
                & ~User.id.in_(select(user_roles.c.user_id).where(user_roles.c.role_id.in_(admin_role_ids)))
            )
            base = base.where(admin_filter)
            count_base = count_base.where(admin_filter)
        count_result = await db.execute(count_base)
        total = count_result.scalar() or 0
        result = await db.execute(
            base
            .options(selectinload(User.roles), selectinload(User.server_accesses))
            .order_by(User.username)
            .offset(skip)
            .limit(limit)
        )
        users = list(result.scalars().all())
        return users, total

    @staticmethod
    async def get_stats(db: AsyncSession, tenant_id: str | None = None, exclude_admins: bool = False) -> dict:
        """Return { total, active, inactive } user counts scoped to tenant. exclude_admins=True for dashboard (don't count admin)."""
        base = select(func.count()).select_from(User)
        if tenant_id:
            base = base.where(User.tenant_id == tenant_id)
        if exclude_admins:
            admin_role_ids = select(Role.id).where(Role.name == "admin")
            base = base.where(
                User.is_superuser == False,  # noqa: E712
                ~User.id.in_(select(user_roles.c.user_id).where(user_roles.c.role_id.in_(admin_role_ids))),
            )
        total_r = await db.execute(base)
        total = total_r.scalar() or 0
        active_base = base.where(User.is_active == True)  # noqa: E712
        active_r = await db.execute(active_base)
        active = active_r.scalar() or 0
        return {"total": total, "active": active, "inactive": total - active}

    @staticmethod
    async def get_online_users(db: AsyncSession, within_minutes: int = 5, tenant_id: str | None = None) -> list[dict]:
        """Return list of users with last_seen_at within the last N minutes. Includes connected_to: servers where they have an active SSH session (from server session reports)."""
        since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=within_minutes)
        admin_role_ids = select(Role.id).where(Role.name == "admin")
        q = (
            select(User)
            .where(User.is_active == True, User.last_seen_at >= since)  # noqa: E712
            .where(User.is_superuser == False)  # noqa: E712
            .where(~User.id.in_(select(user_roles.c.user_id).where(user_roles.c.role_id.in_(admin_role_ids))))
            .order_by(User.last_seen_at.desc().nulls_last())
        )
        if tenant_id:
            q = q.where(User.tenant_id == tenant_id)
        r = await db.execute(q)
        users = list(r.scalars().all())
        reports = await server_service.get_recent_session_reports(db, within_minutes=3)

        # Batch-load servers for all online users at once (avoid N+1)
        from app.models.server import Server
        all_servers_r = await db.execute(select(Server).order_by(Server.hostname))
        all_servers = {s.id: s for s in all_servers_r.scalars().all()}

        result = []
        for u in users:
            if u.is_superuser:
                user_servers = list(all_servers.values())
            else:
                eff_access = await server_service.get_user_effective_server_access(db, str(u.id), tenant_id=u.tenant_id)
                user_server_ids = {a["server_id"] for a in eff_access}
                user_servers = [all_servers[sid] for sid in user_server_ids if sid in all_servers]
            linux_name = server_service._linux_username(u.username or "")
            connected_to = []
            for s in user_servers:
                if s.id in reports and linux_name in reports[s.id]:
                    connected_to.append({"id": s.id, "hostname": s.hostname, "friendly_name": getattr(s, "friendly_name", None)})
            result.append({
                "user_id": u.id,
                "username": u.username,
                "email": u.email,
                "last_seen_at": u.last_seen_at.isoformat() if u.last_seen_at else None,
                "servers": [
                    {"id": s.id, "hostname": s.hostname, "friendly_name": getattr(s, "friendly_name", None)}
                    for s in user_servers
                ],
                "connected_to": connected_to,
            })
        return result

    @staticmethod
    async def update_user(db: AsyncSession, user_id: str, data: UserUpdate) -> User | None:
        user = await UserService.get_user(db, user_id)
        if not user:
            return None
        if data.email is not None:
            existing = await db.execute(select(User).where(User.email == data.email, User.id != user_id))
            if existing.scalar_one_or_none():
                raise HTTPException(status_code=400, detail="Email already in use")
            user.email = data.email
        if data.username is not None:
            existing = await db.execute(select(User).where(User.username == data.username, User.id != user_id))
            if existing.scalar_one_or_none():
                raise HTTPException(status_code=400, detail="Username already in use")
            user.username = data.username
        if data.phone is not None:
            user.phone = data.phone
        if data.password is not None:
            user.hashed_password = get_password_hash(data.password)
        if data.is_active is not None:
            user.is_active = data.is_active
        if data.totp_enabled is not None:
            # Admin can disable 2FA for a user (set False); we do not allow enabling via API
            if not data.totp_enabled:
                user.totp_enabled = False
                user.totp_secret = None
        if data.role_ids is not None:
            await UserService._assign_roles(db, user_id, data.role_ids)
        if data.server_access is not None:
            accesses = [{"server_id": a.server_id, "role": a.role} for a in data.server_access]
            await server_service.set_user_server_accesses(db, user_id, accesses)
            if data.server_access:
                await user_key_service.ensure_user_has_ssh_key(db, user_id)
                for a in accesses:
                    await server_service.set_sync_requested(db, a["server_id"])
        await db.flush()
        await db.refresh(user)
        return await UserService.get_user(db, user_id)

    @staticmethod
    async def delete_user(db: AsyncSession, user_id: str) -> bool:
        user = await UserService.get_user(db, user_id)
        if not user:
            return False
        await db.delete(user)
        await db.flush()
        return True
