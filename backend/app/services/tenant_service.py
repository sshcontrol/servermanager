"""Tenant lifecycle: signup, plan management, subscription handling."""

import logging
import secrets
from datetime import timedelta
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from fastapi import HTTPException, status

from app.models import User, Server, Tenant, Plan, Subscription, DeploymentToken, UserInvitation
from app.models.role import Role
from app.models.association import user_roles
from app.models.user import generate_uuid, utcnow_naive
from app.core.security import get_password_hash

logger = logging.getLogger(__name__)


class TenantService:

    @staticmethod
    async def get_free_plan(db: AsyncSession) -> Plan:
        result = await db.execute(select(Plan).where(Plan.is_free == True, Plan.is_active == True))  # noqa: E712
        plan = result.scalar_one_or_none()
        if not plan:
            raise HTTPException(status_code=500, detail="No free plan configured")
        return plan

    @staticmethod
    async def signup(
        db: AsyncSession,
        company_name: str,
        full_name: str,
        email: str,
        password: str,
    ) -> tuple["Tenant", "User"]:
        existing = await db.execute(select(User).where(User.email == email))
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this email already exists",
            )

        username = email.split("@")[0]
        base_username = username
        counter = 1
        while True:
            check = await db.execute(select(User).where(User.username == username))
            if not check.scalar_one_or_none():
                break
            username = f"{base_username}{counter}"
            counter += 1

        user = User(
            email=email,
            username=username,
            full_name=full_name,
            hashed_password=get_password_hash(password),
            is_active=True,
            is_superuser=True,
            email_verified=False,
            onboarding_completed=False,
            needs_initial_username=True,
        )
        db.add(user)
        await db.flush()

        tenant = Tenant(
            company_name=company_name,
            owner_id=user.id,
        )
        db.add(tenant)
        await db.flush()

        user.tenant_id = tenant.id
        await db.flush()

        # Assign "admin" role to tenant owner
        role_result = await db.execute(select(Role).where(Role.name == "admin"))
        admin_role = role_result.scalar_one_or_none()
        if admin_role:
            await db.execute(user_roles.insert().values(user_id=user.id, role_id=admin_role.id))
            await db.flush()

        free_plan = await TenantService.get_free_plan(db)
        now = utcnow_naive()
        sub = Subscription(
            tenant_id=tenant.id,
            plan_id=free_plan.id,
            is_active=True,
            starts_at=now,
            expires_at=now + timedelta(days=free_plan.duration_days),
            created_at=now,
        )
        db.add(sub)
        await db.flush()

        deploy_token = DeploymentToken(
            id=generate_uuid(),
            tenant_id=tenant.id,
            token=secrets.token_hex(32),
        )
        db.add(deploy_token)
        await db.flush()

        return tenant, user

    @staticmethod
    async def get_active_subscription(db: AsyncSession, tenant_id: str) -> Optional[Subscription]:
        result = await db.execute(
            select(Subscription)
            .where(Subscription.tenant_id == tenant_id, Subscription.is_active == True)  # noqa: E712
            .order_by(Subscription.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def get_plan_limits(db: AsyncSession, tenant_id: str) -> dict:
        """Get limits from the tenant's active subscription plan. Always reads from DB;
        when superadmin assigns a new plan or edits plan max_users/max_servers, the
        updated limits take effect immediately on the next check."""
        sub = await TenantService.get_active_subscription(db, tenant_id)
        if not sub:
            return {"max_users": 0, "max_servers": 0, "plan_name": "None"}

        result = await db.execute(select(Plan).where(Plan.id == sub.plan_id))
        plan = result.scalar_one_or_none()
        if not plan:
            return {"max_users": 0, "max_servers": 0, "plan_name": "None"}

        return {
            "max_users": plan.max_users,
            "max_servers": plan.max_servers,
            "plan_name": plan.name,
            "plan_id": plan.id,
            "starts_at": sub.starts_at,
            "expires_at": sub.expires_at,
        }

    @staticmethod
    async def count_tenant_users(db: AsyncSession, tenant_id: str) -> int:
        result = await db.execute(
            select(func.count(User.id)).where(User.tenant_id == tenant_id, User.is_active == True)  # noqa: E712
        )
        return result.scalar_one()

    @staticmethod
    async def count_tenant_servers(db: AsyncSession, tenant_id: str) -> int:
        result = await db.execute(
            select(func.count(Server.id)).where(Server.tenant_id == tenant_id)
        )
        return result.scalar_one()

    @staticmethod
    async def count_tenant_pending_invitations(db: AsyncSession, tenant_id: str) -> int:
        now = utcnow_naive()
        result = await db.execute(
            select(func.count(UserInvitation.id)).where(
                UserInvitation.tenant_id == tenant_id,
                UserInvitation.accepted == False,  # noqa: E712
                UserInvitation.expires_at > now,
            )
        )
        return result.scalar_one()

    @staticmethod
    async def check_user_limit(db: AsyncSession, tenant_id: str, include_pending_invitations: bool = False) -> None:
        limits = await TenantService.get_plan_limits(db, tenant_id)
        current = await TenantService.count_tenant_users(db, tenant_id)
        if include_pending_invitations:
            pending = await TenantService.count_tenant_pending_invitations(db, tenant_id)
            current += pending
        if current >= limits["max_users"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"User limit reached ({limits['max_users']}). Upgrade your plan to add more users.",
            )

    @staticmethod
    async def check_server_limit(db: AsyncSession, tenant_id: str) -> None:
        limits = await TenantService.get_plan_limits(db, tenant_id)
        current = await TenantService.count_tenant_servers(db, tenant_id)
        if current >= limits["max_servers"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Server limit reached ({limits['max_servers']}). Upgrade your plan to add more servers.",
            )

    @staticmethod
    async def list_tenants(db: AsyncSession, page: int = 1, page_size: int = 50):
        offset = (page - 1) * page_size
        total_result = await db.execute(select(func.count(Tenant.id)))
        total = total_result.scalar_one()

        result = await db.execute(
            select(Tenant)
            .order_by(Tenant.created_at.desc())
            .offset(offset)
            .limit(page_size)
        )
        tenants = result.scalars().all()
        return tenants, total

    @staticmethod
    async def get_tenant(db: AsyncSession, tenant_id: str) -> Tenant:
        result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
        tenant = result.scalar_one_or_none()
        if not tenant:
            raise HTTPException(status_code=404, detail="Tenant not found")
        return tenant

    @staticmethod
    async def update_tenant(db: AsyncSession, tenant_id: str, **kwargs) -> Tenant:
        tenant = await TenantService.get_tenant(db, tenant_id)
        for k, v in kwargs.items():
            if v is not None and hasattr(tenant, k):
                setattr(tenant, k, v)
        await db.flush()
        return tenant

    @staticmethod
    async def assign_plan(db: AsyncSession, tenant_id: str, plan_id: str) -> Subscription:
        result = await db.execute(select(Plan).where(Plan.id == plan_id))
        plan = result.scalar_one_or_none()
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found")

        old_subs = await db.execute(
            select(Subscription).where(
                Subscription.tenant_id == tenant_id,
                Subscription.is_active == True,  # noqa: E712
            )
        )
        for old in old_subs.scalars().all():
            old.is_active = False
        await db.flush()

        now = utcnow_naive()
        sub = Subscription(
            tenant_id=tenant_id,
            plan_id=plan_id,
            is_active=True,
            starts_at=now,
            expires_at=now + timedelta(days=plan.duration_days) if plan.duration_days else None,
            created_at=now,
        )
        db.add(sub)
        await db.flush()
        return sub
