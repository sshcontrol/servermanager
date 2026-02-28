"""Superadmin endpoints: manage tenants, plans, email settings & templates."""

import csv
import io
import logging
from datetime import date, datetime, time, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response

from app.services import audit_service
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc

from app.config import get_settings
from app.database import get_db
from app.core.auth import get_current_user, verify_destructive_verification_token
from app.models import User, Server, Tenant, Plan, Subscription, EmailSettings, EmailTemplate, PlatformSettings, Notification, PaymentTransaction, SmppSettings, SmppCallback
from app.services.invoice_service import generate_invoice_pdf
from app.models.association import user_roles
from app.models.role import Role
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
        stripe_price_id=data.stripe_price_id,
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
        owner_id=str(t.owner_id) if t.owner_id else None,
        owner_email=owner.email if owner else None,
        owner_full_name=owner.full_name if owner else None,
        owner_username=owner.username if owner else None,
        owner_phone=owner.phone if owner else None,
        owner_totp_enabled=owner.totp_enabled if owner else None,
        owner_sms_verification_enabled=getattr(owner, "sms_verification_enabled", False) if owner else None,
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
    owner_email = update_data.pop("owner_email", None)
    owner_phone = update_data.pop("owner_phone", None)
    owner_totp_enabled = update_data.pop("owner_totp_enabled", None)
    owner_sms_verification_enabled = update_data.pop("owner_sms_verification_enabled", None)

    t = await TenantService.update_tenant(db, tenant_id, **update_data)

    if t.owner_id:
        owner_result = await db.execute(select(User).where(User.id == t.owner_id))
        owner = owner_result.scalar_one_or_none()
        if owner:
            if owner_email is not None:
                existing = await db.execute(select(User).where(User.email == owner_email, User.id != owner.id))
                if existing.scalar_one_or_none():
                    raise HTTPException(status_code=409, detail="An account with this email already exists")
                owner.email = owner_email
            if owner_phone is not None:
                owner.phone = owner_phone
            if owner_totp_enabled is not None:
                if not owner_totp_enabled:
                    owner.totp_enabled = False
                    owner.totp_secret = None
                else:
                    raise HTTPException(
                        status_code=400,
                        detail="2FA can only be disabled by superadmin. User must enable 2FA themselves.",
                    )
            if owner_sms_verification_enabled is not None:
                owner.sms_verification_enabled = owner_sms_verification_enabled
            await db.flush()

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

    # Cancel Stripe subscription so we won't charge the deleted tenant again
    try:
        from app.services.stripe_service import cancel_subscription_for_tenant
        await cancel_subscription_for_tenant(db, tenant_id, cancel_immediately=True)
    except Exception:
        pass  # Continue with deletion even if Stripe cancel fails

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


class TenantUserItem(BaseModel):
    id: str
    username: str
    email: str
    full_name: Optional[str] = None
    email_verified: bool
    totp_enabled: bool
    is_active: bool
    is_owner: bool

    class Config:
        from_attributes = True


@router.get("/tenants/{tenant_id}/users", response_model=list[TenantUserItem])
async def list_tenant_users(
    tenant_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """List all users belonging to a tenant (superadmin only)."""
    _require_platform_superadmin(current_user)
    t = await TenantService.get_tenant(db, tenant_id)
    users = await TenantService.list_tenant_users(db, tenant_id)
    return [
        TenantUserItem(
            id=u.id,
            username=u.username,
            email=u.email,
            full_name=u.full_name,
            email_verified=getattr(u, "email_verified", False) or False,
            totp_enabled=u.totp_enabled or False,
            is_active=u.is_active,
            is_owner=u.id == t.owner_id,
        )
        for u in users
    ]


class SuperadminUserItem(BaseModel):
    id: str
    username: str
    email: str
    full_name: Optional[str] = None
    tenant_id: Optional[str] = None
    company_name: Optional[str] = None
    email_verified: bool
    totp_enabled: bool
    sms_verification_enabled: bool
    is_active: bool
    is_superuser: bool
    created_at: datetime

    class Config:
        from_attributes = True


class SuperadminUserUpdate(BaseModel):
    totp_enabled: Optional[bool] = None
    sms_verification_enabled: Optional[bool] = None
    email_verified: Optional[bool] = None  # Superadmin can set to True to verify user


@router.get("/users", response_model=dict)
async def list_all_users(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: Optional[str] = Query(None),
):
    """List all users platform-wide (superadmin only)."""
    _require_platform_superadmin(current_user)
    q = select(User).where(User.tenant_id.isnot(None))
    if search and search.strip():
        s = f"%{search.strip()}%"
        q = q.where(
            (User.username.ilike(s)) | (User.email.ilike(s)) | (User.full_name.ilike(s))
        )
    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar() or 0
    q = q.order_by(User.created_at.desc()).offset(skip).limit(limit)
    result = await db.execute(q)
    users = result.scalars().all()
    tenant_ids = {u.tenant_id for u in users if u.tenant_id}
    tenants = {}
    if tenant_ids:
        t_rows = await db.execute(select(Tenant).where(Tenant.id.in_(tenant_ids)))
        for t in t_rows.scalars().all():
            tenants[t.id] = t.company_name
    items = [
        SuperadminUserItem(
            id=u.id,
            username=u.username,
            email=u.email,
            full_name=u.full_name,
            tenant_id=u.tenant_id,
            company_name=tenants.get(u.tenant_id) if u.tenant_id else None,
            email_verified=getattr(u, "email_verified", False) or False,
            totp_enabled=u.totp_enabled or False,
            sms_verification_enabled=getattr(u, "sms_verification_enabled", False) or False,
            is_active=u.is_active,
            is_superuser=u.is_superuser or False,
            created_at=u.created_at,
        )
        for u in users
    ]
    return {"users": items, "total": total}


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Delete a tenant user (superadmin only). User can then be invited or register again."""
    _require_platform_superadmin(current_user)
    from app.services.user_service import UserService
    r = await db.execute(select(User).where(User.id == user_id))
    u = r.scalar_one_or_none()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    if u.tenant_id is None:
        raise HTTPException(status_code=403, detail="Cannot delete platform superadmin")
    deleted_username = u.username
    ok = await UserService.delete_user(db, user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="User not found")
    await audit_service.log(
        db, "user_deleted",
        resource_type="user", resource_id=user_id,
        user_id=str(current_user.id), username=current_user.username,
        details=f"username={deleted_username} (superadmin delete)",
    )


@router.patch("/users/{user_id}")
async def update_user_security(
    user_id: str,
    data: SuperadminUserUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Update user's totp_enabled, sms_verification_enabled, or email_verified (superadmin only)."""
    _require_platform_superadmin(current_user)
    r = await db.execute(select(User).where(User.id == user_id))
    u = r.scalar_one_or_none()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    if u.tenant_id is None:
        raise HTTPException(status_code=403, detail="Cannot modify platform superadmin")
    if data.totp_enabled is not None:
        u.totp_enabled = data.totp_enabled
        if not data.totp_enabled:
            u.totp_secret = None
    if data.sms_verification_enabled is not None:
        u.sms_verification_enabled = data.sms_verification_enabled
    if data.email_verified is True:
        u.email_verified = True
    elif data.email_verified is False:
        raise HTTPException(status_code=400, detail="Cannot unverify email. User must verify again via email.")
    await db.flush()
    return {"message": "Updated"}


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
    # Keep it short: prefix + fixed asterisks + suffix (avoids overflow)
    return key[:8] + "****" + key[-4:]


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


# ─── SMS (SMPP) Settings ───────────────────────────────────────────────────────

class SmppSettingsResponse(BaseModel):
    link: str
    username: str
    password_masked: str
    sender_name: str
    enabled: bool


class SmppSettingsUpdate(BaseModel):
    link: Optional[str] = Field(None, max_length=500)
    username: Optional[str] = Field(None, max_length=255)
    password: Optional[str] = Field(None, max_length=255)
    sender_name: Optional[str] = Field(None, max_length=50)
    enabled: Optional[bool] = None


class SmppCallbackItem(BaseModel):
    id: str
    callback_type: str
    message_id: Optional[str] = None
    status: Optional[str] = None
    raw_payload: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("/sms/settings", response_model=SmppSettingsResponse)
async def get_smpp_settings(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _require_platform_superadmin(current_user)
    result = await db.execute(select(SmppSettings).where(SmppSettings.id == "1"))
    cfg = result.scalar_one_or_none()
    if not cfg:
        return SmppSettingsResponse(link="", username="", password_masked="", sender_name="SSHCONTROL", enabled=False)
    return SmppSettingsResponse(
        link=cfg.link or "",
        username=cfg.username or "",
        password_masked=_mask_key(cfg.password) if cfg.password else "",
        sender_name=getattr(cfg, "sender_name", None) or "SSHCONTROL",
        enabled=cfg.enabled or False,
    )


@router.patch("/sms/settings", response_model=SmppSettingsResponse)
async def update_smpp_settings(
    data: SmppSettingsUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _require_platform_superadmin(current_user)
    result = await db.execute(select(SmppSettings).where(SmppSettings.id == "1"))
    cfg = result.scalar_one_or_none()
    if not cfg:
        from app.models.user import utcnow_naive
        cfg = SmppSettings(id="1", updated_at=utcnow_naive())
        db.add(cfg)

    if data.link is not None:
        cfg.link = data.link
    if data.username is not None:
        cfg.username = data.username
    if data.password is not None:
        cfg.password = data.password
    if data.sender_name is not None:
        cfg.sender_name = data.sender_name
    if data.enabled is not None:
        cfg.enabled = data.enabled
    await db.flush()

    return SmppSettingsResponse(
        link=cfg.link or "",
        username=cfg.username or "",
        password_masked=_mask_key(cfg.password) if cfg.password else "",
        sender_name=getattr(cfg, "sender_name", None) or "SSHCONTROL",
        enabled=cfg.enabled or False,
    )


class TestSmsRequest(BaseModel):
    to_phone: str = Field(..., min_length=10, max_length=20, description="E.164 phone number")


@router.post("/sms/test")
async def send_test_sms(
    data: TestSmsRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _require_platform_superadmin(current_user)
    from app.services import sms_service
    ok, err = await sms_service.send_sms(db, data.to_phone, "SSHCONTROL test: SMS gateway connected successfully.")
    if ok:
        return {"message": f"Test SMS sent to {data.to_phone}"}
    detail = err or "Could not send SMS. Check SMPP settings (link, username, password) and ensure the service is enabled."
    raise HTTPException(status_code=503, detail=detail)


@router.get("/sms/callbacks", response_model=dict)
async def list_smpp_callbacks(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    _require_platform_superadmin(current_user)
    offset = (page - 1) * page_size
    result = await db.execute(
        select(SmppCallback)
        .order_by(desc(SmppCallback.created_at))
        .offset(offset)
        .limit(page_size)
    )
    callbacks = result.scalars().all()
    count_result = await db.execute(select(func.count(SmppCallback.id)))
    total = count_result.scalar() or 0
    return {
        "callbacks": [
            SmppCallbackItem(
                id=c.id,
                callback_type=c.callback_type or "",
                message_id=c.message_id,
                status=c.status,
                raw_payload=c.raw_payload,
                created_at=c.created_at,
            )
            for c in callbacks
        ],
        "total": total,
    }


@router.get("/sms/webhook-url")
async def get_sms_webhook_url(
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Return the public webhook URL for SMPP callbacks. Use this URL in your SMPP provider dashboard."""
    _require_platform_superadmin(current_user)
    settings = get_settings()
    base = (settings.public_api_url or "").rstrip("/")
    return {"webhook_url": f"{base}/api/webhooks/smpp" if base else ""}


@router.post("/sms/test-callback")
async def create_test_sms_callback(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Create a test callback record to verify the Callbacks tab works. Does not require SMPP provider."""
    _require_platform_superadmin(current_user)
    import time
    cb = SmppCallback(
        callback_type="test",
        message_id=f"test-{int(time.time() * 1000)}",
        status="delivered",
        raw_payload='{"type":"test","status":"delivered","message":"Manual test from superadmin"}',
    )
    db.add(cb)
    await db.commit()
    return {"message": "Test callback created. Refresh the Callbacks tab to see it."}


# ─── Platform Settings (Google Analytics, Ads, SEO) ────────────────────────────

class PlatformSettingsResponse(BaseModel):
    google_analytics_id: str
    google_ads_id: str
    google_ads_conversion_label: str
    google_tag_manager_id: str
    google_oauth_client_id: str
    google_oauth_client_secret_masked: str
    recaptcha_site_key: str
    recaptcha_secret_key_masked: str
    seo_site_title: str
    seo_meta_description: Optional[str] = None
    seo_keywords: str
    seo_og_image_url: str
    # Stripe
    stripe_secret_key_masked: str
    stripe_publishable_key: str
    stripe_webhook_secret_masked: str
    stripe_enabled: bool
    # Renewal reminders
    renewal_reminder_days_before: int
    renewal_reminder_send_email: bool
    renewal_reminder_send_sms: bool
    renewal_reminder_send_notification: bool
    # Overdue: email for daily overdue reminders (e.g. info@sshcontrol.com)
    overdue_reminder_email: str


class PlatformSettingsUpdate(BaseModel):
    google_analytics_id: Optional[str] = Field(None, max_length=50)
    google_ads_id: Optional[str] = Field(None, max_length=50)
    google_ads_conversion_label: Optional[str] = Field(None, max_length=100)
    google_tag_manager_id: Optional[str] = Field(None, max_length=50)
    google_oauth_client_id: Optional[str] = Field(None, max_length=255)
    google_oauth_client_secret: Optional[str] = Field(None, max_length=500)
    recaptcha_site_key: Optional[str] = Field(None, max_length=100)
    recaptcha_secret_key: Optional[str] = Field(None, max_length=255)
    seo_site_title: Optional[str] = Field(None, max_length=100)
    seo_meta_description: Optional[str] = None
    seo_keywords: Optional[str] = Field(None, max_length=500)
    seo_og_image_url: Optional[str] = Field(None, max_length=500)
    # Stripe
    stripe_secret_key: Optional[str] = Field(None, max_length=255)
    stripe_publishable_key: Optional[str] = Field(None, max_length=255)
    stripe_webhook_secret: Optional[str] = Field(None, max_length=255)
    stripe_enabled: Optional[bool] = None
    # Renewal reminders
    renewal_reminder_days_before: Optional[int] = Field(None, ge=0, le=90)
    renewal_reminder_send_email: Optional[bool] = None
    renewal_reminder_send_sms: Optional[bool] = None
    renewal_reminder_send_notification: Optional[bool] = None
    overdue_reminder_email: Optional[str] = Field(None, max_length=255)


@router.get("/settings", response_model=PlatformSettingsResponse)
async def get_platform_settings(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _require_platform_superadmin(current_user)
    result = await db.execute(select(PlatformSettings).where(PlatformSettings.id == "1"))
    cfg = result.scalar_one_or_none()
    if not cfg:
        return PlatformSettingsResponse(
            google_analytics_id="", google_ads_id="", google_ads_conversion_label="",
            google_tag_manager_id="", google_oauth_client_id="", google_oauth_client_secret_masked="",
            recaptcha_site_key="", recaptcha_secret_key_masked="",
            seo_site_title="SSHCONTROL", seo_meta_description=None, seo_keywords="", seo_og_image_url="",
            stripe_secret_key_masked="", stripe_publishable_key="", stripe_webhook_secret_masked="",
            stripe_enabled=False,
            renewal_reminder_days_before=3, renewal_reminder_send_email=True,
            renewal_reminder_send_sms=False, renewal_reminder_send_notification=True,
            overdue_reminder_email="info@sshcontrol.com",
        )
    return PlatformSettingsResponse(
        google_analytics_id=cfg.google_analytics_id or "",
        google_ads_id=cfg.google_ads_id or "",
        google_ads_conversion_label=cfg.google_ads_conversion_label or "",
        google_tag_manager_id=cfg.google_tag_manager_id or "",
        google_oauth_client_id=cfg.google_oauth_client_id or "",
        google_oauth_client_secret_masked=_mask_key(cfg.google_oauth_client_secret or ""),
        recaptcha_site_key=getattr(cfg, "recaptcha_site_key", None) or "",
        recaptcha_secret_key_masked=_mask_key(getattr(cfg, "recaptcha_secret_key", None) or ""),
        seo_site_title=cfg.seo_site_title or "SSHCONTROL",
        seo_meta_description=cfg.seo_meta_description,
        seo_keywords=cfg.seo_keywords or "",
        seo_og_image_url=cfg.seo_og_image_url or "",
        stripe_secret_key_masked=_mask_key(getattr(cfg, "stripe_secret_key", None) or ""),
        stripe_publishable_key=getattr(cfg, "stripe_publishable_key", None) or "",
        stripe_webhook_secret_masked=_mask_key(getattr(cfg, "stripe_webhook_secret", None) or ""),
        stripe_enabled=getattr(cfg, "stripe_enabled", False) or False,
        renewal_reminder_days_before=getattr(cfg, "renewal_reminder_days_before", 3) or 3,
        renewal_reminder_send_email=getattr(cfg, "renewal_reminder_send_email", True) if hasattr(cfg, "renewal_reminder_send_email") else True,
        renewal_reminder_send_sms=getattr(cfg, "renewal_reminder_send_sms", False) if hasattr(cfg, "renewal_reminder_send_sms") else False,
        renewal_reminder_send_notification=getattr(cfg, "renewal_reminder_send_notification", True) if hasattr(cfg, "renewal_reminder_send_notification") else True,
        overdue_reminder_email=getattr(cfg, "overdue_reminder_email", "info@sshcontrol.com") or "info@sshcontrol.com",
    )


@router.patch("/settings", response_model=PlatformSettingsResponse)
async def update_platform_settings(
    data: PlatformSettingsUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _require_platform_superadmin(current_user)
    result = await db.execute(select(PlatformSettings).where(PlatformSettings.id == "1"))
    cfg = result.scalar_one_or_none()
    if not cfg:
        from app.models.user import utcnow_naive
        cfg = PlatformSettings(id="1", updated_at=utcnow_naive())
        db.add(cfg)
        await db.flush()

    update_data = data.model_dump(exclude_unset=True)
    for secret_key in ("google_oauth_client_secret", "stripe_secret_key", "stripe_webhook_secret", "recaptcha_secret_key"):
        if secret_key in update_data and update_data[secret_key] == "":
            del update_data[secret_key]  # Don't overwrite with empty
    for k, v in update_data.items():
        if hasattr(cfg, k):
            setattr(cfg, k, v)
    await db.flush()

    return PlatformSettingsResponse(
        google_analytics_id=cfg.google_analytics_id or "",
        google_ads_id=cfg.google_ads_id or "",
        google_ads_conversion_label=cfg.google_ads_conversion_label or "",
        google_tag_manager_id=cfg.google_tag_manager_id or "",
        google_oauth_client_id=cfg.google_oauth_client_id or "",
        google_oauth_client_secret_masked=_mask_key(cfg.google_oauth_client_secret or ""),
        recaptcha_site_key=getattr(cfg, "recaptcha_site_key", None) or "",
        recaptcha_secret_key_masked=_mask_key(getattr(cfg, "recaptcha_secret_key", None) or ""),
        seo_site_title=cfg.seo_site_title or "SSHCONTROL",
        seo_meta_description=cfg.seo_meta_description,
        seo_keywords=cfg.seo_keywords or "",
        seo_og_image_url=cfg.seo_og_image_url or "",
        stripe_secret_key_masked=_mask_key(getattr(cfg, "stripe_secret_key", None) or ""),
        stripe_publishable_key=getattr(cfg, "stripe_publishable_key", None) or "",
        stripe_webhook_secret_masked=_mask_key(getattr(cfg, "stripe_webhook_secret", None) or ""),
        stripe_enabled=getattr(cfg, "stripe_enabled", False) or False,
        renewal_reminder_days_before=getattr(cfg, "renewal_reminder_days_before", 3) or 3,
        renewal_reminder_send_email=getattr(cfg, "renewal_reminder_send_email", True) if hasattr(cfg, "renewal_reminder_send_email") else True,
        renewal_reminder_send_sms=getattr(cfg, "renewal_reminder_send_sms", False) if hasattr(cfg, "renewal_reminder_send_sms") else False,
        renewal_reminder_send_notification=getattr(cfg, "renewal_reminder_send_notification", True) if hasattr(cfg, "renewal_reminder_send_notification") else True,
        overdue_reminder_email=getattr(cfg, "overdue_reminder_email", "info@sshcontrol.com") or "info@sshcontrol.com",
    )


# ─── Notifications: send to admins/users ───────────────────────────────────────

class SendNotificationRequest(BaseModel):
    recipient_ids: list[str] = Field(..., min_length=1, max_length=500)
    subject: Optional[str] = Field(None, max_length=255)
    message: str = Field(..., min_length=1, max_length=10000)
    notification_type: str = Field("announcement", pattern="^(announcement|payment_reminder|system)$")


@router.get("/notifications/recipients")
async def list_notification_recipients(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    admins_only: bool = Query(True, description="If true, only list tenant admins (owners + admin role)"),
):
    """List users that superadmin can send notifications to (admins by default)."""
    _require_platform_superadmin(current_user)

    tenant_owners = select(Tenant.owner_id).where(Tenant.owner_id.isnot(None))  # noqa: E711
    admin_role = select(Role.id).where(Role.name == "admin")

    users_q = (
        select(User, Tenant.company_name)
        .outerjoin(Tenant, User.tenant_id == Tenant.id)
        .where(User.is_active == True)  # noqa: E712
        .where(User.tenant_id.isnot(None))  # noqa: E711 - exclude platform superadmin
    )

    if admins_only:
        users_q = users_q.where(
            (User.id.in_(tenant_owners.subquery()))
            | (User.id.in_(select(user_roles.c.user_id).where(user_roles.c.role_id.in_(admin_role)))),
        )

    users_q = users_q.order_by(Tenant.company_name).order_by(User.username)
    result = await db.execute(users_q)
    rows = result.all()

    return [
        {
            "id": u.id,
            "username": u.username,
            "email": u.email,
            "full_name": u.full_name,
            "company_name": company or "",
        }
        for u, company in rows
    ]


# ─── Payment transactions & due dates (superadmin) ─────────────────────────────

class TransactionItem(BaseModel):
    id: str
    tenant_id: str
    company_name: str
    plan_name: str
    amount: str
    currency: str
    status: str
    created_at: str
    failure_reason: Optional[str] = None


class DueDateItem(BaseModel):
    tenant_id: str
    company_name: str
    plan_name: str
    expires_at: str
    auto_renew: bool


class IncomeSummaryResponse(BaseModel):
    today_total: str
    today_currency: str
    month_total: str
    month_currency: str
    custom_total: Optional[str] = None
    custom_currency: Optional[str] = None
    custom_from: Optional[str] = None
    custom_to: Optional[str] = None


@router.get("/payment/income-summary", response_model=IncomeSummaryResponse)
async def get_income_summary(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    custom_from: Optional[date] = Query(None, description="Start date for custom range"),
    custom_to: Optional[date] = Query(None, description="End date for custom range"),
):
    """Get total income for today, this month, and optional custom date range (succeeded payments only)."""
    _require_platform_superadmin(current_user)
    # Use naive UTC to match PaymentTransaction.created_at (stored without timezone)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    today_start = datetime.combine(now.date(), time.min)
    month_start = datetime(now.year, now.month, 1)

    async def _sum_in_range(start_dt: datetime, end_dt: datetime) -> tuple[float, str]:
        r = await db.execute(
            select(func.coalesce(func.sum(PaymentTransaction.amount), 0), func.max(PaymentTransaction.currency))
            .where(
                PaymentTransaction.status == "succeeded",
                PaymentTransaction.created_at >= start_dt,
                PaymentTransaction.created_at <= end_dt,
            )
        )
        row = r.one()
        total = float(row[0] or 0)
        curr = (row[1] or "USD").upper()
        return (total, curr)

    today_total, today_curr = await _sum_in_range(today_start, now)
    month_total, month_curr = await _sum_in_range(month_start, now)

    custom_total_str = None
    custom_curr = None
    custom_from_str = None
    custom_to_str = None
    if custom_from is not None and custom_to is not None and custom_from <= custom_to:
        start_dt = datetime.combine(custom_from, time.min)
        end_dt = datetime.combine(custom_to, time(23, 59, 59, 999999))
        ct, cc = await _sum_in_range(start_dt, end_dt)
        custom_total_str = f"{ct:.2f}"
        custom_curr = (cc or "USD").upper()
        custom_from_str = custom_from.isoformat()
        custom_to_str = custom_to.isoformat()

    return IncomeSummaryResponse(
        today_total=f"{today_total:.2f}",
        today_currency=today_curr,
        month_total=f"{month_total:.2f}",
        month_currency=month_curr,
        custom_total=custom_total_str,
        custom_currency=custom_curr,
        custom_from=custom_from_str,
        custom_to=custom_to_str,
    )


@router.get("/payment/export")
async def export_payments_report(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    from_date: Optional[date] = Query(None, alias="from", description="Start date"),
    to_date: Optional[date] = Query(None, alias="to", description="End date"),
):
    """Export received payments report as CSV. Filter by date range. Defaults to all time if no dates."""
    _require_platform_superadmin(current_user)
    q = (
        select(PaymentTransaction, Tenant.company_name, Plan.name)
        .outerjoin(Tenant, PaymentTransaction.tenant_id == Tenant.id)
        .outerjoin(Plan, PaymentTransaction.plan_id == Plan.id)
        .where(PaymentTransaction.status == "succeeded")
        .order_by(PaymentTransaction.created_at)
    )
    # Use naive UTC to match PaymentTransaction.created_at (stored without timezone)
    if from_date is not None:
        start_dt = datetime.combine(from_date, time.min)
        q = q.where(PaymentTransaction.created_at >= start_dt)
    if to_date is not None:
        end_dt = datetime.combine(to_date, time(23, 59, 59, 999999))
        q = q.where(PaymentTransaction.created_at <= end_dt)

    result = await db.execute(q)
    rows = result.all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["Date", "Tenant", "Plan", "Amount", "Currency", "Transaction ID"])
    for pt, company, plan_name in rows:
        writer.writerow([
            pt.created_at.strftime("%Y-%m-%d %H:%M") if pt.created_at else "",
            company or pt.company_name or "",
            plan_name or "",
            str(pt.amount),
            pt.currency or "USD",
            str(pt.id),
        ])

    csv_bytes = buffer.getvalue().encode("utf-8-sig")
    filename = "payments-report.csv"
    if from_date and to_date:
        filename = f"payments-report-{from_date}-{to_date}.csv"
    elif from_date:
        filename = f"payments-report-from-{from_date}.csv"
    elif to_date:
        filename = f"payments-report-to-{to_date}.csv"

    return Response(
        content=csv_bytes,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/payment/transactions", response_model=list[TransactionItem])
async def list_all_transactions(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: int = Query(100, ge=1, le=500),
):
    _require_platform_superadmin(current_user)
    result = await db.execute(
        select(PaymentTransaction, Tenant.company_name, Plan.name)
        .outerjoin(Tenant, PaymentTransaction.tenant_id == Tenant.id)
        .outerjoin(Plan, PaymentTransaction.plan_id == Plan.id)
        .order_by(desc(PaymentTransaction.created_at))
        .limit(limit)
    )
    rows = result.all()
    return [
        TransactionItem(
            id=str(pt.id),
            tenant_id=pt.tenant_id or "",
            company_name=(company or pt.company_name or ""),
            plan_name=plan_name or "",
            amount=str(pt.amount),
            currency=pt.currency,
            status=pt.status,
            created_at=pt.created_at.isoformat() if pt.created_at else "",
            failure_reason=pt.failure_reason,
        )
        for pt, company, plan_name in rows
    ]


@router.get("/payment/due-dates", response_model=list[DueDateItem])
async def list_subscription_due_dates(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _require_platform_superadmin(current_user)
    result = await db.execute(
        select(Subscription, Tenant.company_name, Plan.name)
        .join(Tenant, Subscription.tenant_id == Tenant.id)
        .join(Plan, Subscription.plan_id == Plan.id)
        .where(Subscription.is_active == True, Subscription.expires_at.isnot(None))  # noqa: E712
        .order_by(Subscription.expires_at)
    )
    rows = result.all()
    return [
        DueDateItem(
            tenant_id=sub.tenant_id,
            company_name=company or "",
            plan_name=plan_name or "",
            expires_at=sub.expires_at.isoformat() if sub.expires_at else "",
            auto_renew=sub.auto_renew or False,
        )
        for sub, company, plan_name in rows
    ]


@router.get("/payment/invoices/{transaction_id}/download")
async def superadmin_download_invoice(
    transaction_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Download PDF invoice for any payment (superadmin only)."""
    _require_platform_superadmin(current_user)
    result = await db.execute(
        select(PaymentTransaction, Plan.name, Plan.duration_label, Plan.max_users, Plan.max_servers, Tenant)
        .outerjoin(Tenant, PaymentTransaction.tenant_id == Tenant.id)
        .outerjoin(Plan, PaymentTransaction.plan_id == Plan.id)
        .where(PaymentTransaction.id == transaction_id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Invoice not found")
    pt, plan_name, duration_label, max_users, max_servers, tenant = row
    import json
    from decimal import Decimal
    billing_address = json.loads(tenant.billing_address) if tenant and tenant.billing_address else None
    amount_decimal = Decimal(str(pt.amount)) if pt.amount is not None else Decimal("0")
    from datetime import datetime, timezone
    platform_name = "SSHCONTROL"
    r = await db.execute(select(PlatformSettings).where(PlatformSettings.id == "1"))
    cfg = r.scalar_one_or_none()
    if cfg and getattr(cfg, "seo_site_title", None):
        platform_name = cfg.seo_site_title
    pdf_bytes = generate_invoice_pdf(
        invoice_number=f"INV-{pt.created_at.strftime('%Y%m%d')}-{str(pt.id)[:8].upper()}" if pt.created_at else f"INV-{str(pt.id)[:8].upper()}",
        invoice_date=pt.created_at or datetime.now(timezone.utc).replace(tzinfo=None),
        company_name=(tenant.company_name if tenant else pt.company_name) or "Customer",
        billing_address=billing_address,
        billing_email=tenant.billing_email if tenant else None,
        plan_name=plan_name or "Plan",
        amount=amount_decimal,
        currency=pt.currency,
        status=pt.status.capitalize(),
        platform_name=platform_name,
        duration_label=duration_label,
        max_users=int(max_users) if max_users is not None else None,
        max_servers=int(max_servers) if max_servers is not None else None,
    )
    if not pdf_bytes or len(pdf_bytes) < 100:
        raise HTTPException(status_code=500, detail="Invoice generation failed")
    company = (tenant.company_name if tenant else pt.company_name) or "customer"
    filename = f"invoice-{company[:20]}-{str(pt.id)[:8]}.pdf".replace(" ", "-")
    return Response(content=pdf_bytes, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.post("/payment/transactions/{transaction_id}/refund")
async def refund_transaction(
    transaction_id: str,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Refund a succeeded payment. Requires verification (password + email/2FA/SMS)."""
    _require_platform_superadmin(current_user)
    verify_destructive_verification_token(request, current_user, "refund_transaction", transaction_id)
    from app.services.stripe_service import refund_transaction as stripe_refund
    result = await stripe_refund(db, transaction_id)
    if result["success"]:
        await audit_service.log(
            db, "payment_refunded",
            resource_type="payment_transaction", resource_id=transaction_id,
            user_id=str(current_user.id), username=current_user.username,
            details=f"transaction_id={transaction_id}",
        )
        return {"message": result["message"]}
    raise HTTPException(status_code=400, detail=result["message"])


@router.post("/payment/transactions/{transaction_id}/recharge")
async def recharge_transaction(
    transaction_id: str,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Retry charge or create new charge for same amount. Requires verification (password + email/2FA/SMS)."""
    _require_platform_superadmin(current_user)
    verify_destructive_verification_token(request, current_user, "recharge_transaction", transaction_id)
    from app.services.stripe_service import recharge_transaction as stripe_recharge
    result = await stripe_recharge(db, transaction_id)
    if result["success"]:
        await audit_service.log(
            db, "payment_recharged",
            resource_type="payment_transaction", resource_id=transaction_id,
            user_id=str(current_user.id), username=current_user.username,
            details=f"transaction_id={transaction_id}",
        )
        return {"message": result["message"]}
    raise HTTPException(status_code=400, detail=result["message"])


# ─── Superadmin History (all tenants, with IP) ─────────────────────────────────

@router.get("/history")
async def get_superadmin_history(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    action: Optional[str] = Query(None, description="Filter by action"),
    tenant_id: Optional[str] = Query(None, description="Filter by tenant ID"),
):
    """Return audit log entries for all tenants with tenant name and IP (superadmin only)."""
    _require_platform_superadmin(current_user)
    entries = await audit_service.get_superadmin_logs(
        db, skip=skip, limit=limit, action=action, tenant_id=tenant_id
    )
    total = await audit_service.get_superadmin_logs_count(
        db, action=action, tenant_id=tenant_id
    )
    return {
        "entries": [
            {
                "id": e.id,
                "created_at": e.created_at.isoformat() if e.created_at else None,
                "action": e.action,
                "resource_type": e.resource_type,
                "resource_id": e.resource_id,
                "user_id": e.user_id,
                "username": e.username,
                "ip_address": e.ip_address,
                "tenant_name": company_name,
                "details": e.details,
            }
            for e, company_name in entries
        ],
        "total": total,
    }


@router.get("/history/export")
async def export_superadmin_history_csv(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    action: Optional[str] = Query(None, description="Filter by action"),
    tenant_id: Optional[str] = Query(None, description="Filter by tenant ID"),
):
    """Export full audit history for all tenants as CSV with IP addresses (superadmin only)."""
    _require_platform_superadmin(current_user)
    entries = await audit_service.get_superadmin_logs_for_export(
        db, action=action, tenant_id=tenant_id
    )
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "id", "created_at", "action", "resource_type", "resource_id",
        "user_id", "username", "tenant", "ip_address", "details",
    ])
    for e, company_name in entries:
        writer.writerow([
            e.id,
            e.created_at.isoformat() if e.created_at else "",
            e.action or "",
            e.resource_type or "",
            e.resource_id or "",
            e.user_id or "",
            e.username or "",
            company_name or "",
            e.ip_address or "",
            e.details or "",
        ])
    csv_content = buf.getvalue().encode("utf-8-sig")
    filename = f"superadmin-history-{datetime.now(timezone.utc).strftime('%Y-%m-%d-%H%M')}.csv"
    return Response(
        content=csv_content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/notifications/send")
async def send_notification(
    data: SendNotificationRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Send notification to selected users (superadmin only)."""
    _require_platform_superadmin(current_user)

    created = []
    for rid in data.recipient_ids:
        n = Notification(
            recipient_id=rid,
            sender_id=str(current_user.id),
            subject=data.subject,
            message=data.message,
            notification_type=data.notification_type,
        )
        db.add(n)
        await db.flush()
        created.append(n.id)

    return {"message": f"Sent to {len(created)} recipient(s)", "count": len(created)}
