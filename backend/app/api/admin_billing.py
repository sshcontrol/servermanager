"""Admin billing: address, invoices, payment history, cancel subscription, checkout."""

import json
from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.database import get_db
from app.core.auth import get_current_user, require_superuser
from app.models import User, Tenant, Subscription, Plan, PaymentTransaction
from app.services.stripe_service import create_checkout_session, cancel_subscription_for_tenant
from app.services.invoice_service import generate_invoice_pdf

router = APIRouter(prefix="/admin/billing", tags=["admin-billing"])


class CheckoutRequest(BaseModel):
    plan_id: str = Field(..., min_length=1)
    auto_renew: bool = False
    success_url: Optional[str] = Field(None, max_length=500)  # Frontend passes origin + path so redirect matches user's tab
    cancel_url: Optional[str] = Field(None, max_length=500)


def _require_tenant_admin(current_user: Annotated[User, Depends(require_superuser)]):
    """Admin must belong to a tenant (not platform superadmin)."""
    if not current_user.tenant_id:
        raise HTTPException(status_code=403, detail="Billing is for tenant admins only")
    return current_user


class BillingInfoResponse(BaseModel):
    billing_address: Optional[dict] = None  # {line1, line2, city, state, postal_code, country}
    billing_email: Optional[str] = None
    receive_invoices: bool
    plan_name: Optional[str] = None
    expires_at: Optional[str] = None
    auto_renew: bool


class BillingInfoUpdate(BaseModel):
    line1: Optional[str] = Field(None, max_length=255)
    line2: Optional[str] = Field(None, max_length=255)
    city: Optional[str] = Field(None, max_length=100)
    state: Optional[str] = Field(None, max_length=100)
    postal_code: Optional[str] = Field(None, max_length=20)
    country: Optional[str] = Field(None, max_length=2)
    billing_email: Optional[EmailStr] = None
    receive_invoices: Optional[bool] = None


class PaymentItem(BaseModel):
    id: str
    amount: str
    currency: str
    status: str
    plan_name: Optional[str] = None
    created_at: str
    failure_reason: Optional[str] = None


@router.get("", response_model=BillingInfoResponse)
async def get_billing_info(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(_require_tenant_admin)],
):
    result = await db.execute(
        select(Tenant)
        .where(Tenant.id == current_user.tenant_id)
    )
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    sub = await _get_active_subscription(db, str(tenant.id))
    plan_name = None
    expires_at = None
    auto_renew = False
    if sub:
        plan_result = await db.execute(select(Plan).where(Plan.id == sub.plan_id))
        plan = plan_result.scalar_one_or_none()
        plan_name = plan.name if plan else None
        expires_at = sub.expires_at.isoformat() if sub.expires_at else None
        auto_renew = sub.auto_renew or False

    billing_address = None
    if tenant.billing_address:
        try:
            billing_address = json.loads(tenant.billing_address)
        except Exception:
            pass

    return BillingInfoResponse(
        billing_address=billing_address,
        billing_email=tenant.billing_email,
        receive_invoices=tenant.receive_invoices if hasattr(tenant, "receive_invoices") else True,
        plan_name=plan_name,
        expires_at=expires_at,
        auto_renew=auto_renew,
    )


@router.patch("", response_model=BillingInfoResponse)
async def update_billing_info(
    data: BillingInfoUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(_require_tenant_admin)],
):
    result = await db.execute(
        select(Tenant).where(Tenant.id == current_user.tenant_id)
    )
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    update = data.model_dump(exclude_unset=True)
    if "line1" in update or "line2" in update or "city" in update or "state" in update or "postal_code" in update or "country" in update:
        addr = {}
        if tenant.billing_address:
            try:
                addr = json.loads(tenant.billing_address)
            except Exception:
                pass
        for k in ("line1", "line2", "city", "state", "postal_code", "country"):
            if k in update and update[k] is not None:
                addr[k] = update[k]
        tenant.billing_address = json.dumps(addr) if addr else None
        for k in ("line1", "line2", "city", "state", "postal_code", "country"):
            update.pop(k, None)

    if "billing_email" in update:
        tenant.billing_email = update["billing_email"]
    if "receive_invoices" in update:
        tenant.receive_invoices = update["receive_invoices"]

    await db.flush()
    await db.refresh(tenant)

    sub = await _get_active_subscription(db, str(current_user.tenant_id))
    plan_name = None
    expires_at = None
    auto_renew = False
    if sub:
        plan_result = await db.execute(select(Plan).where(Plan.id == sub.plan_id))
        plan = plan_result.scalar_one_or_none()
        plan_name = plan.name if plan else None
        expires_at = sub.expires_at.isoformat() if sub.expires_at else None
        auto_renew = sub.auto_renew or False

    billing_address = None
    if tenant.billing_address:
        try:
            billing_address = json.loads(tenant.billing_address)
        except Exception:
            pass

    return BillingInfoResponse(
        billing_address=billing_address,
        billing_email=tenant.billing_email,
        receive_invoices=tenant.receive_invoices,
        plan_name=plan_name,
        expires_at=expires_at,
        auto_renew=auto_renew,
    )


@router.get("/payments", response_model=list[PaymentItem])
async def list_payments(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(_require_tenant_admin)],
):
    result = await db.execute(
        select(PaymentTransaction, Plan.name)
        .outerjoin(Plan, PaymentTransaction.plan_id == Plan.id)
        .where(PaymentTransaction.tenant_id == current_user.tenant_id)
        .order_by(desc(PaymentTransaction.created_at))
        .limit(50)
    )
    rows = result.all()
    return [
        PaymentItem(
            id=str(pt.id),
            amount=str(pt.amount),
            currency=pt.currency,
            status=pt.status,
            plan_name=plan_name,
            created_at=pt.created_at.isoformat() if pt.created_at else "",
            failure_reason=pt.failure_reason,
        )
        for pt, plan_name in rows
    ]


@router.post("/checkout")
async def create_billing_checkout(
    data: CheckoutRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(_require_tenant_admin)],
):
    """Create Stripe Checkout Session for plan upgrade. Returns redirect URL."""
    if not current_user.tenant_id:
        raise HTTPException(status_code=403, detail="Tenant required")
    email = current_user.email or ""
    if not email:
        raise HTTPException(status_code=400, detail="Email required for checkout")
    try:
        result = await create_checkout_session(
            db, str(current_user.tenant_id), data.plan_id, email, data.auto_renew,
            success_url=data.success_url, cancel_url=data.cancel_url,
        )
        return {"url": result["url"]}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Checkout failed: {e}")


class VerifySessionRequest(BaseModel):
    session_id: str = Field(..., min_length=1)


@router.post("/verify-session")
async def verify_checkout_session(
    data: VerifySessionRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(_require_tenant_admin)],
):
    """Verify Stripe checkout session on success redirect. Fallback when webhook hasn't fired (e.g. localhost)."""
    session_id = data.session_id
    if not current_user.tenant_id:
        raise HTTPException(status_code=400, detail="Invalid request")
    from app.services.stripe_service import handle_checkout_session_for_tenant
    try:
        result = await handle_checkout_session_for_tenant(db, session_id, str(current_user.tenant_id))
        await db.commit()
        if result:
            return {
                "verified": True,
                "message": "Payment confirmed",
                "transaction_id": result["transaction_id"],
                "old_plan_name": result["old_plan_name"],
                "new_plan_name": result["new_plan_name"],
                "amount": result["amount"],
                "currency": result["currency"],
            }
        return {"verified": True, "message": "Payment confirmed"}
    except Exception as e:
        await db.rollback()
        # Fallback: if session expired but payment was already processed, find most recent transaction
        from datetime import timedelta
        cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=30)
        fallback = await db.execute(
            select(PaymentTransaction, Plan.name)
            .outerjoin(Plan, PaymentTransaction.plan_id == Plan.id)
            .where(
                PaymentTransaction.tenant_id == current_user.tenant_id,
                PaymentTransaction.status == "succeeded",
                PaymentTransaction.created_at >= cutoff,
            )
            .order_by(desc(PaymentTransaction.created_at))
            .limit(1)
        )
        row = fallback.one_or_none()
        if row:
            pt, plan_name = row
            return {
                "verified": True,
                "message": "Payment confirmed",
                "transaction_id": str(pt.id),
                "old_plan_name": None,
                "new_plan_name": plan_name or "Plan",
                "amount": str(pt.amount),
                "currency": pt.currency or "USD",
            }
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/invoices/{transaction_id}/download")
async def download_invoice(
    transaction_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(_require_tenant_admin)],
):
    """Download PDF invoice for a payment (admin's tenant only)."""
    result = await db.execute(
        select(PaymentTransaction, Plan.name, Plan.duration_label, Plan.max_users, Plan.max_servers, Tenant)
        .join(Tenant, PaymentTransaction.tenant_id == Tenant.id)
        .outerjoin(Plan, PaymentTransaction.plan_id == Plan.id)
        .where(
            PaymentTransaction.id == transaction_id,
            PaymentTransaction.tenant_id == current_user.tenant_id,
        )
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Invoice not found")
    pt, plan_name, duration_label, max_users, max_servers, tenant = row
    billing_address = json.loads(tenant.billing_address) if tenant.billing_address else None
    platform_name = "SSHCONTROL"
    from decimal import Decimal
    amount_decimal = Decimal(str(pt.amount)) if pt.amount is not None else Decimal("0")
    try:
        from app.models import PlatformSettings
        r = await db.execute(select(PlatformSettings).where(PlatformSettings.id == "1"))
        cfg = r.scalar_one_or_none()
        if cfg and getattr(cfg, "seo_site_title", None):
            platform_name = cfg.seo_site_title
    except Exception:
        pass
    pdf_bytes = generate_invoice_pdf(
        invoice_number=f"INV-{pt.created_at.strftime('%Y%m%d')}-{str(pt.id)[:8].upper()}" if pt.created_at else f"INV-{str(pt.id)[:8].upper()}",
        invoice_date=pt.created_at or datetime.now(timezone.utc).replace(tzinfo=None),
        company_name=tenant.company_name or "Customer",
        billing_address=billing_address,
        billing_email=tenant.billing_email,
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
    filename = f"invoice-{str(pt.id)[:8]}.pdf"
    return Response(content=pdf_bytes, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.post("/cancel")
async def cancel_subscription(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(_require_tenant_admin)],
):
    """Disable auto-renew. Cancels Stripe subscription so we won't charge again. Plan remains active until expires_at."""
    sub = await _get_active_subscription(db, str(current_user.tenant_id))
    if not sub:
        raise HTTPException(status_code=404, detail="No active subscription")
    # Cancel at Stripe (cancel_at_period_end) so we won't charge again; also updates our DB
    await cancel_subscription_for_tenant(db, str(current_user.tenant_id), cancel_immediately=False)
    # If no Stripe subscription (one-time payment), still set auto_renew=False in our DB
    if sub.auto_renew:
        sub.auto_renew = False
        await db.flush()
    return {"message": "Auto-renew disabled. Your plan remains active until the end of the billing period."}


async def _get_active_subscription(db: AsyncSession, tenant_id: str) -> Optional[Subscription]:
    result = await db.execute(
        select(Subscription)
        .where(Subscription.tenant_id == tenant_id, Subscription.is_active == True)  # noqa: E712
        .order_by(Subscription.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()
