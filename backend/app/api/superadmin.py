"""Superadmin endpoints: manage tenants, plans, email settings & templates."""

import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database import get_db
from app.core.auth import get_current_user
from app.models import User, Server, Tenant, Plan, Subscription, EmailSettings, EmailTemplate
from app.schemas.tenant import (
    TenantResponse, TenantCreate, TenantUpdate, TenantPlanAssign,
    PlanResponse, PlanCreate, PlanUpdate,
)
from app.services.tenant_service import TenantService

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Pydantic schemas for email management ────────────────────────────────────

class EmailSettingsResponse(BaseModel):
    sendgrid_api_key_masked: str
    from_email: str
    from_name: str
    enabled: bool

class EmailSettingsUpdate(BaseModel):
    sendgrid_api_key: Optional[str] = None
    from_email: Optional[str] = None
    from_name: Optional[str] = None
    enabled: Optional[bool] = None

class EmailTemplateResponse(BaseModel):
    id: str
    template_key: str
    display_name: str
    subject: str
    body_html: str

    class Config:
        from_attributes = True

class EmailTemplateUpdate(BaseModel):
    subject: Optional[str] = Field(None, max_length=255)
    body_html: Optional[str] = None

class TestEmailRequest(BaseModel):
    to_email: EmailStr


def _require_platform_superadmin(user: User):
    if not user.is_superuser:
        raise HTTPException(status_code=403, detail="Platform superadmin access required")
    if user.tenant_id is not None:
        raise HTTPException(status_code=403, detail="Platform superadmin must not belong to a tenant")


# ─── Plans ───────────────────────────────────────────────────────────────────

@router.get("/plans", response_model=list[PlanResponse])
async def list_plans(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _require_platform_superadmin(current_user)
    result = await db.execute(select(Plan).order_by(Plan.sort_order, Plan.price))
    return result.scalars().all()


@router.post("/plans", response_model=PlanResponse, status_code=201)
async def create_plan(
    data: PlanCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _require_platform_superadmin(current_user)
    existing = await db.execute(select(Plan).where(Plan.name == data.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="A plan with this name already exists")

    from app.models.user import utcnow_naive
    now = utcnow_naive()
    plan = Plan(
        name=data.name,
        description=data.description,
        price=data.price,
        currency=data.currency,
        duration_days=data.duration_days,
        duration_label=data.duration_label,
        max_users=data.max_users,
        max_servers=data.max_servers,
        is_free=data.is_free,
        sort_order=data.sort_order,
        created_at=now,
        updated_at=now,
    )
    db.add(plan)
    await db.flush()
    return plan


@router.patch("/plans/{plan_id}", response_model=PlanResponse)
async def update_plan(
    plan_id: str,
    data: PlanUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _require_platform_superadmin(current_user)
    result = await db.execute(select(Plan).where(Plan.id == plan_id))
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    update_data = data.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(plan, k, v)
    await db.flush()
    return plan


@router.delete("/plans/{plan_id}")
async def delete_plan(
    plan_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _require_platform_superadmin(current_user)
    result = await db.execute(select(Plan).where(Plan.id == plan_id))
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    active_subs = await db.execute(
        select(func.count(Subscription.id)).where(
            Subscription.plan_id == plan_id,
            Subscription.is_active == True,  # noqa: E712
        )
    )
    if active_subs.scalar_one() > 0:
        raise HTTPException(status_code=409, detail="Cannot delete a plan with active subscriptions")

    await db.delete(plan)
    await db.flush()
    return {"message": "Plan deleted"}


# ─── Tenants ─────────────────────────────────────────────────────────────────

async def _build_tenant_response(db: AsyncSession, t: Tenant) -> TenantResponse:
    """Build a full TenantResponse with owner profile and subscription info."""
    owner = None
    if t.owner_id:
        owner_result = await db.execute(select(User).where(User.id == t.owner_id))
        owner = owner_result.scalar_one_or_none()

    user_count = await TenantService.count_tenant_users(db, t.id)
    server_count = await TenantService.count_tenant_servers(db, t.id)

    sub = await TenantService.get_active_subscription(db, t.id)
    plan_name = None
    plan_id = None
    sub_expires = None
    if sub:
        plan_result = await db.execute(select(Plan).where(Plan.id == sub.plan_id))
        plan = plan_result.scalar_one_or_none()
        if plan:
            plan_name = plan.name
            plan_id = plan.id
        sub_expires = sub.expires_at

    return TenantResponse(
        id=t.id,
        company_name=t.company_name,
        is_active=t.is_active,
        created_at=t.created_at,
        owner_email=owner.email if owner else None,
        owner_full_name=owner.full_name if owner else None,
        owner_username=owner.username if owner else None,
        owner_phone=owner.phone if owner else None,
        owner_totp_enabled=owner.totp_enabled if owner else None,
        owner_email_verified=owner.email_verified if owner else None,
        owner_last_seen_at=owner.last_seen_at if owner else None,
        plan_name=plan_name,
        plan_id=plan_id,
        subscription_expires_at=sub_expires,
        user_count=user_count,
        server_count=server_count,
    )


@router.get("/tenants", response_model=dict)
async def list_tenants(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    page: int = 1,
    page_size: int = 50,
):
    _require_platform_superadmin(current_user)
    tenants, total = await TenantService.list_tenants(db, page, page_size)
    items = [await _build_tenant_response(db, t) for t in tenants]
    return {"tenants": items, "total": total}


@router.post("/tenants", response_model=TenantResponse, status_code=201)
async def create_tenant(
    data: TenantCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Create a new tenant (admin) manually from the superadmin panel."""
    _require_platform_superadmin(current_user)

    tenant, user = await TenantService.signup(
        db,
        company_name=data.company_name,
        full_name=data.full_name,
        email=data.email,
        password=data.password,
    )
    # Auto-verify email for superadmin-created tenants
    user.email_verified = True
    await db.flush()

    # Assign specific plan if provided (otherwise keeps the default free plan)
    if data.plan_id:
        await TenantService.assign_plan(db, tenant.id, data.plan_id)

    return await _build_tenant_response(db, tenant)


@router.get("/tenants/{tenant_id}", response_model=TenantResponse)
async def get_tenant(
    tenant_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _require_platform_superadmin(current_user)
    t = await TenantService.get_tenant(db, tenant_id)
    return await _build_tenant_response(db, t)


@router.patch("/tenants/{tenant_id}", response_model=TenantResponse)
async def update_tenant(
    tenant_id: str,
    data: TenantUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _require_platform_superadmin(current_user)
    update_data = data.model_dump(exclude_unset=True)
    t = await TenantService.update_tenant(db, tenant_id, **update_data)
    return await _build_tenant_response(db, t)


@router.delete("/tenants/{tenant_id}")
async def delete_tenant(
    tenant_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Delete a tenant and all associated data (users, servers, keys, etc.)."""
    _require_platform_superadmin(current_user)
    t = await TenantService.get_tenant(db, tenant_id)

    # Clear owner_id first to avoid FK conflicts when deleting users
    t.owner_id = None
    await db.flush()

    # Delete all users belonging to this tenant
    users_result = await db.execute(select(User).where(User.tenant_id == tenant_id))
    for u in users_result.scalars().all():
        await db.delete(u)
    await db.flush()

    # Delete the tenant (cascades to subscriptions, invitations, servers,
    # deployment tokens, platform keys, whitelist entries)
    await db.delete(t)
    await db.flush()

    return {"message": "Tenant and all associated data deleted"}


@router.post("/tenants/{tenant_id}/assign-plan")
async def assign_plan_to_tenant(
    tenant_id: str,
    data: TenantPlanAssign,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _require_platform_superadmin(current_user)
    sub = await TenantService.assign_plan(db, tenant_id, data.plan_id)
    return {"message": "Plan assigned", "subscription_id": sub.id}


# ─── Email Settings ─────────────────────────────────────────────────────────

def _mask_key(key: str) -> str:
    if not key or len(key) < 12:
        return "***" if key else ""
    return key[:6] + "*" * (len(key) - 10) + key[-4:]


@router.get("/email/settings", response_model=EmailSettingsResponse)
async def get_email_settings(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _require_platform_superadmin(current_user)
    result = await db.execute(select(EmailSettings).where(EmailSettings.id == "1"))
    cfg = result.scalar_one_or_none()
    if not cfg:
        return EmailSettingsResponse(
            sendgrid_api_key_masked="", from_email="noreply@sshcontrol.com",
            from_name="SSHCONTROL", enabled=False,
        )
    return EmailSettingsResponse(
        sendgrid_api_key_masked=_mask_key(cfg.sendgrid_api_key),
        from_email=cfg.from_email,
        from_name=cfg.from_name,
        enabled=cfg.enabled,
    )


@router.patch("/email/settings", response_model=EmailSettingsResponse)
async def update_email_settings(
    data: EmailSettingsUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _require_platform_superadmin(current_user)
    result = await db.execute(select(EmailSettings).where(EmailSettings.id == "1"))
    cfg = result.scalar_one_or_none()
    if not cfg:
        from app.models.user import utcnow_naive
        cfg = EmailSettings(id="1", updated_at=utcnow_naive())
        db.add(cfg)

    if data.sendgrid_api_key is not None:
        cfg.sendgrid_api_key = data.sendgrid_api_key
    if data.from_email is not None:
        cfg.from_email = data.from_email
    if data.from_name is not None:
        cfg.from_name = data.from_name
    if data.enabled is not None:
        cfg.enabled = data.enabled
    await db.flush()

    return EmailSettingsResponse(
        sendgrid_api_key_masked=_mask_key(cfg.sendgrid_api_key),
        from_email=cfg.from_email,
        from_name=cfg.from_name,
        enabled=cfg.enabled,
    )


@router.post("/email/test")
async def send_test_email(
    data: TestEmailRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _require_platform_superadmin(current_user)
    from app.services.email_service import send_test_email
    ok = await send_test_email(db, data.to_email)
    if ok:
        return {"message": f"Test email sent to {data.to_email}"}
    raise HTTPException(status_code=500, detail="Failed to send test email. Check SendGrid API key and settings.")


# ─── Email Templates ────────────────────────────────────────────────────────

@router.get("/email/templates", response_model=list[EmailTemplateResponse])
async def list_email_templates(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _require_platform_superadmin(current_user)
    result = await db.execute(select(EmailTemplate).order_by(EmailTemplate.template_key))
    return result.scalars().all()


@router.get("/email/templates/{template_key}", response_model=EmailTemplateResponse)
async def get_email_template(
    template_key: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _require_platform_superadmin(current_user)
    result = await db.execute(
        select(EmailTemplate).where(EmailTemplate.template_key == template_key)
    )
    tpl = result.scalar_one_or_none()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    return tpl


@router.patch("/email/templates/{template_key}", response_model=EmailTemplateResponse)
async def update_email_template(
    template_key: str,
    data: EmailTemplateUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _require_platform_superadmin(current_user)
    result = await db.execute(
        select(EmailTemplate).where(EmailTemplate.template_key == template_key)
    )
    tpl = result.scalar_one_or_none()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    if data.subject is not None:
        tpl.subject = data.subject
    if data.body_html is not None:
        tpl.body_html = data.body_html
    await db.flush()
    return tpl
