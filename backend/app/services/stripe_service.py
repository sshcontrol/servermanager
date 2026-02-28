"""Stripe payment service: checkout, webhooks."""

import json
import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

import stripe
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models import Tenant, Plan, Subscription, PlatformSettings, PaymentTransaction, Notification
from app.services.invoice_service import generate_invoice_pdf
from app.services import email_service
from app.models.user import generate_uuid, utcnow_naive

logger = logging.getLogger(__name__)


async def _get_stripe_config(db: AsyncSession) -> Optional[tuple[str, str, str, bool]]:
    """Returns (secret_key, webhook_secret, frontend_url, enabled) or None."""
    result = await db.execute(select(PlatformSettings).where(PlatformSettings.id == "1"))
    cfg = result.scalar_one_or_none()
    if not cfg or not getattr(cfg, "stripe_enabled", False):
        return None
    sk = getattr(cfg, "stripe_secret_key", None) or ""
    wh = getattr(cfg, "stripe_webhook_secret", None) or ""
    if not sk:
        return None
    from app.config import get_settings
    frontend_url = get_settings().frontend_url.rstrip("/")
    return (sk, wh, frontend_url, True)


async def create_checkout_session(
    db: AsyncSession,
    tenant_id: str,
    plan_id: str,
    admin_email: str,
    auto_renew: bool = False,
    success_url: Optional[str] = None,
    cancel_url: Optional[str] = None,
) -> dict:
    """
    Create Stripe Checkout Session.
    When auto_renew=True: uses subscription mode (Stripe handles recurring billing at due date).
    When auto_renew=False: uses one-time payment mode.
    Returns {"url": str} or raises.
    """
    config = await _get_stripe_config(db)
    if not config:
        raise ValueError("Stripe is not configured or disabled")
    secret_key, _, frontend_url, _ = config

    result = await db.execute(select(Plan).where(Plan.id == plan_id))
    plan = result.scalar_one_or_none()
    if not plan:
        raise ValueError("Plan not found")
    if plan.is_free:
        raise ValueError("Cannot pay for free plan")

    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise ValueError("Tenant not found")

    stripe.api_key = secret_key

    metadata = {"tenant_id": tenant_id, "plan_id": plan_id, "auto_renew": str(auto_renew).lower()}
    success = success_url or f"{frontend_url}/#/payment-result?payment_success=true&session_id={{CHECKOUT_SESSION_ID}}"
    cancel = cancel_url or f"{frontend_url}/#/payment-result?canceled=true"

    if auto_renew:
        # Subscription mode: Stripe charges automatically at each billing cycle
        line_items = []
        if plan.stripe_price_id:
            line_items.append({"price": plan.stripe_price_id, "quantity": 1})
        else:
            amount_cents = int(float(plan.price) * 100)
            interval = "year" if plan.duration_days >= 365 else "month"
            line_items.append({
                "price_data": {
                    "currency": (plan.currency or "usd").lower(),
                    "unit_amount": amount_cents,
                    "product_data": {
                        "name": plan.name,
                        "description": plan.description or f"{plan.duration_label} - {plan.max_users} users, {plan.max_servers} servers",
                    },
                    "recurring": {"interval": interval},
                },
                "quantity": 1,
            })
        session_params = {
            "mode": "subscription",
            "line_items": line_items,
            "success_url": success,
            "cancel_url": cancel,
            "customer_email": admin_email,
            "metadata": metadata,
            "subscription_data": {"metadata": metadata},
        }
        if tenant.stripe_customer_id:
            session_params["customer"] = tenant.stripe_customer_id
            session_params.pop("customer_email", None)
    else:
        line_items = []
        if plan.stripe_price_id:
            line_items.append({"price": plan.stripe_price_id, "quantity": 1})
        else:
            amount_cents = int(float(plan.price) * 100)
            line_items.append({
                "price_data": {
                    "currency": (plan.currency or "usd").lower(),
                    "unit_amount": amount_cents,
                    "product_data": {
                        "name": plan.name,
                        "description": plan.description or f"{plan.duration_label} - {plan.max_users} users, {plan.max_servers} servers",
                    },
                },
                "quantity": 1,
            })
        session_params = {
            "mode": "payment",
            "line_items": line_items,
            "success_url": success,
            "cancel_url": cancel,
            "customer_email": admin_email,
            "metadata": metadata,
        }
        if tenant.stripe_customer_id:
            session_params["customer"] = tenant.stripe_customer_id
            session_params.pop("customer_email", None)

    session = stripe.checkout.Session.create(**session_params)
    return {"url": session.url, "session_id": session.id}


async def handle_checkout_session_for_tenant(
    db: AsyncSession,
    session_id: str,
    expected_tenant_id: Optional[str] = None,
) -> Optional[dict]:
    """
    Verify and process a checkout session. Used by webhook and by verify-session fallback.
    If expected_tenant_id is set, only process if session metadata matches (for verify-session).
    Returns dict with transaction_id, old_plan_name, new_plan_name, amount, currency or None if skipped.
    """
    payment_intent_id = None
    customer_id = None
    result = await db.execute(select(PlatformSettings).where(PlatformSettings.id == "1"))
    cfg = result.scalar_one_or_none()
    if not cfg:
        return None
    sk = getattr(cfg, "stripe_secret_key", None) or ""
    if not sk:
        return None
    stripe.api_key = sk
    try:
        session = stripe.checkout.Session.retrieve(session_id, expand=["line_items", "subscription", "invoice"])
    except Exception as e:
        logger.warning("Stripe session retrieve failed: %s", e)
        raise ValueError("Invalid or expired session") from e
    payment_intent_id = session.get("payment_intent")
    subscription_id = session.get("subscription")
    invoice_id = session.get("invoice")
    customer_id = session.get("customer")
    tenant_id = session.metadata.get("tenant_id")
    if expected_tenant_id and tenant_id != expected_tenant_id:
        raise ValueError("Session does not belong to your organization")
    return await handle_checkout_completed(db, session_id, payment_intent_id, customer_id, subscription_id=subscription_id, invoice_id=invoice_id)


async def handle_checkout_completed(
    db: AsyncSession,
    session_id: str,
    payment_intent_id: Optional[str],
    customer_id: Optional[str],
    subscription_id: Optional[str] = None,
    invoice_id: Optional[str] = None,
) -> Optional[dict]:
    """
    Handle checkout.session.completed: create subscription, record payment.
    Supports both payment mode (one-time) and subscription mode (recurring).
    Returns dict with transaction_id, old_plan_name, new_plan_name, amount, currency.
    """
    result = await db.execute(select(PlatformSettings).where(PlatformSettings.id == "1"))
    cfg = result.scalar_one_or_none()
    if not cfg:
        return None
    sk = getattr(cfg, "stripe_secret_key", None) or ""
    if not sk:
        return None
    stripe.api_key = sk

    try:
        session = stripe.checkout.Session.retrieve(session_id, expand=["line_items", "subscription", "invoice"])
    except Exception as e:
        logger.warning("Stripe session retrieve failed: %s", e)
        return None

    tenant_id = session.metadata.get("tenant_id")
    plan_id = session.metadata.get("plan_id")
    auto_renew = (session.metadata.get("auto_renew") or "false").lower() == "true"

    if not tenant_id or not plan_id:
        logger.warning("Checkout session missing tenant_id or plan_id in metadata")
        return None

    # Idempotency: already processed (e.g. by webhook)?
    from sqlalchemy import or_
    idempotency_conditions = []
    if payment_intent_id:
        idempotency_conditions.append(PaymentTransaction.stripe_payment_intent_id == payment_intent_id)
    if invoice_id:
        idempotency_conditions.append(PaymentTransaction.stripe_invoice_id == invoice_id)
    if idempotency_conditions:
        existing = await db.execute(
            select(PaymentTransaction, Plan.name)
            .outerjoin(Plan, PaymentTransaction.plan_id == Plan.id)
            .where(or_(*idempotency_conditions))
        )
        row = existing.one_or_none()
        if row:
            pt_existing, plan_name = row
            logger.info("Payment already processed for session %s", session_id)
            return {
                "transaction_id": str(pt_existing.id),
                "old_plan_name": None,
                "new_plan_name": plan_name or "Plan",
                "amount": str(pt_existing.amount),
                "currency": pt_existing.currency,
            }

    result = await db.execute(select(Plan).where(Plan.id == plan_id))
    plan = result.scalar_one_or_none()
    if not plan:
        logger.warning("Plan %s not found", plan_id)
        return None

    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        logger.warning("Tenant %s not found", tenant_id)
        return None

    # Get old plan name before deactivating
    old_plan_name = None
    old_sub = await db.execute(
        select(Subscription, Plan.name)
        .join(Plan, Subscription.plan_id == Plan.id)
        .where(Subscription.tenant_id == tenant_id, Subscription.is_active == True)  # noqa: E712
        .order_by(Subscription.created_at.desc())
        .limit(1)
    )
    old_row = old_sub.one_or_none()
    if old_row:
        old_plan_name = old_row[1]

    # Update tenant stripe_customer_id if new
    if customer_id and not tenant.stripe_customer_id:
        tenant.stripe_customer_id = customer_id

    amount = Decimal("0")
    currency = "usd"
    if session.amount_total:
        amount = Decimal(session.amount_total) / 100
    if session.currency:
        currency = session.currency.upper()
    # For subscription mode, amount/currency may be on the expanded invoice
    inv_obj = session.get("invoice")
    if inv_obj and (not amount or amount == 0):
        if isinstance(inv_obj, dict) and inv_obj.get("amount_paid"):
            amount = Decimal(inv_obj["amount_paid"]) / 100
        if isinstance(inv_obj, dict) and inv_obj.get("currency"):
            currency = inv_obj["currency"].upper()
    elif invoice_id and (not amount or amount == 0):
        try:
            inv = stripe.Invoice.retrieve(invoice_id)
            if inv.amount_paid:
                amount = Decimal(inv.amount_paid) / 100
            if inv.currency:
                currency = inv.currency.upper()
        except Exception as e:
            logger.warning("Could not retrieve invoice for amount: %s", e)

    # Deactivate current subscription
    from sqlalchemy import update
    await db.execute(
        update(Subscription)
        .where(Subscription.tenant_id == tenant_id)
        .values(is_active=False)
    )

    # Create new subscription
    now = utcnow_naive()
    expires_at = now + timedelta(days=plan.duration_days)
    sub = Subscription(
        id=generate_uuid(),
        tenant_id=tenant_id,
        plan_id=plan_id,
        is_active=True,
        starts_at=now,
        expires_at=expires_at,
        auto_renew=auto_renew,
        stripe_subscription_id=subscription_id,
        created_at=now,
    )
    db.add(sub)
    await db.flush()

    # Record payment transaction (company_name preserved when tenant is deleted)
    pt_invoice_id = invoice_id
    if not pt_invoice_id and session.get("invoice"):
        inv = session["invoice"]
        pt_invoice_id = inv.get("id") if isinstance(inv, dict) else inv
    pt = PaymentTransaction(
        id=generate_uuid(),
        tenant_id=tenant_id,
        company_name=tenant.company_name,
        plan_id=plan_id,
        stripe_payment_intent_id=payment_intent_id,
        stripe_invoice_id=pt_invoice_id,
        amount=amount,
        currency=currency,
        status="succeeded",
        created_at=now,
    )
    db.add(pt)
    await db.flush()
    logger.info("Payment succeeded: tenant=%s plan=%s amount=%s", tenant_id, plan_id, amount)

    # In-app notification: "Your order placed successfully and your plan is [plan name]"
    if tenant.owner_id:
        try:
            n = Notification(
                id=generate_uuid(),
                recipient_id=tenant.owner_id,
                sender_id=None,
                subject="Order placed successfully",
                message=f"Your order was placed successfully. Your plan is now {plan.name or 'Plan'}.",
                notification_type="system",
            )
            db.add(n)
            await db.flush()
        except Exception as e:
            logger.warning("Failed to create plan renewal notification: %s", e)

    # Send invoice by email if tenant has receive_invoices and billing_email
    if getattr(tenant, "receive_invoices", True) and tenant.billing_email:
        try:
            billing_address = json.loads(tenant.billing_address) if tenant.billing_address else None
            platform_name = "SSHCONTROL"
            try:
                r = await db.execute(select(PlatformSettings).where(PlatformSettings.id == "1"))
                pcfg = r.scalar_one_or_none()
                if pcfg and getattr(pcfg, "seo_site_title", None):
                    platform_name = pcfg.seo_site_title
            except Exception:
                pass
            invoice_number = f"INV-{pt.created_at.strftime('%Y%m%d')}-{str(pt.id)[:8].upper()}" if pt.created_at else f"INV-{str(pt.id)[:8].upper()}"
            pdf_bytes = generate_invoice_pdf(
                invoice_number=invoice_number,
                invoice_date=pt.created_at or datetime.now(timezone.utc).replace(tzinfo=None),
                company_name=tenant.company_name or "Customer",
                billing_address=billing_address,
                billing_email=tenant.billing_email,
                plan_name=plan.name or "Plan",
                amount=amount,
                currency=currency,
                status="Paid",
                platform_name=platform_name,
                duration_label=plan.duration_label,
                max_users=plan.max_users,
                max_servers=plan.max_servers,
            )
            if pdf_bytes and len(pdf_bytes) >= 100:
                await email_service.send_invoice_email(
                    db,
                    to_email=tenant.billing_email,
                    pdf_bytes=pdf_bytes,
                    invoice_number=invoice_number,
                    plan_name=plan.name or "Plan",
                    amount=str(amount),
                    currency=currency,
                    filename=f"invoice-{str(pt.id)[:8]}.pdf",
                )
        except Exception as e:
            logger.warning("Failed to send invoice email: %s", e)

    return {
        "transaction_id": str(pt.id),
        "old_plan_name": old_plan_name,
        "new_plan_name": plan.name,
        "amount": str(amount),
        "currency": currency,
    }


async def handle_invoice_paid(db: AsyncSession, invoice: dict) -> None:
    """
    Handle invoice.paid webhook. For subscription renewals (billing_reason=subscription_cycle),
    extend the subscription and record the payment.
    """
    billing_reason = invoice.get("billing_reason")
    if billing_reason == "subscription_create":
        # First invoice - already handled by checkout.session.completed
        return
    if billing_reason != "subscription_cycle":
        logger.debug("Skipping invoice.paid with billing_reason=%s", billing_reason)
        return

    subscription_id = invoice.get("subscription")
    if not subscription_id:
        return

    # Idempotency: already processed?
    invoice_id = invoice.get("id")
    if invoice_id:
        existing = await db.execute(
            select(PaymentTransaction).where(PaymentTransaction.stripe_invoice_id == invoice_id)
        )
        if existing.scalar_one_or_none():
            logger.info("Invoice %s already processed", invoice_id)
            return

    result = await db.execute(
        select(Subscription, Plan, Tenant)
        .join(Plan, Subscription.plan_id == Plan.id)
        .join(Tenant, Subscription.tenant_id == Tenant.id)
        .where(Subscription.stripe_subscription_id == subscription_id, Subscription.is_active == True)  # noqa: E712
    )
    row = result.one_or_none()
    if not row:
        logger.warning("No active subscription found for Stripe subscription %s", subscription_id)
        return

    sub, plan, tenant = row
    now = utcnow_naive()
    # Extend expires_at from current (or now if past)
    current_end = sub.expires_at if sub.expires_at and sub.expires_at > now else now
    sub.expires_at = current_end + timedelta(days=plan.duration_days)
    sub.renewal_reminder_sent_at = None  # Reset so we can send reminder for next period
    await db.flush()

    amount = Decimal(invoice.get("amount_paid", 0)) / 100
    currency = (invoice.get("currency") or "usd").upper()

    pt = PaymentTransaction(
        id=generate_uuid(),
        tenant_id=str(tenant.id),
        company_name=tenant.company_name,
        plan_id=str(plan.id),
        stripe_payment_intent_id=None,
        stripe_invoice_id=invoice_id,
        amount=amount,
        currency=currency,
        status="succeeded",
        created_at=now,
    )
    db.add(pt)
    await db.flush()
    logger.info("Subscription renewed: tenant=%s plan=%s amount=%s", tenant.id, plan.name, amount)

    if tenant.owner_id:
        try:
            n = Notification(
                id=generate_uuid(),
                recipient_id=tenant.owner_id,
                sender_id=None,
                subject="Plan renewed",
                message=f"Your plan {plan.name or 'Plan'} has been renewed. New expiry: {sub.expires_at.date() if sub.expires_at else 'N/A'}.",
                notification_type="system",
            )
            db.add(n)
            await db.flush()
        except Exception as e:
            logger.warning("Failed to create renewal notification: %s", e)

    if getattr(tenant, "receive_invoices", True) and tenant.billing_email:
        try:
            billing_address = json.loads(tenant.billing_address) if tenant.billing_address else None
            platform_name = "SSHCONTROL"
            try:
                r = await db.execute(select(PlatformSettings).where(PlatformSettings.id == "1"))
                pcfg = r.scalar_one_or_none()
                if pcfg and getattr(pcfg, "seo_site_title", None):
                    platform_name = pcfg.seo_site_title
            except Exception:
                pass
            invoice_number = f"INV-{now.strftime('%Y%m%d')}-{str(pt.id)[:8].upper()}"
            pdf_bytes = generate_invoice_pdf(
                invoice_number=invoice_number,
                invoice_date=now,
                company_name=tenant.company_name or "Customer",
                billing_address=billing_address,
                billing_email=tenant.billing_email,
                plan_name=plan.name or "Plan",
                amount=amount,
                currency=currency,
                status="Paid",
                platform_name=platform_name,
                duration_label=plan.duration_label,
                max_users=plan.max_users,
                max_servers=plan.max_servers,
            )
            if pdf_bytes and len(pdf_bytes) >= 100:
                await email_service.send_invoice_email(
                    db,
                    to_email=tenant.billing_email,
                    pdf_bytes=pdf_bytes,
                    invoice_number=invoice_number,
                    plan_name=plan.name or "Plan",
                    amount=str(amount),
                    currency=currency,
                    filename=f"invoice-renewal-{str(pt.id)[:8]}.pdf",
                )
        except Exception as e:
            logger.warning("Failed to send renewal invoice email: %s", e)


async def cancel_subscription_for_tenant(
    db: AsyncSession,
    tenant_id: str,
    cancel_immediately: bool = False,
) -> bool:
    """
    Cancel Stripe subscription for a tenant so we won't charge again.
    - cancel_immediately=False: set cancel_at_period_end (for "Disable auto-renew")
    - cancel_immediately=True: delete subscription now (for account deletion)
    Returns True if a subscription was found and canceled.
    """
    config = await _get_stripe_config(db)
    if not config:
        return False
    secret_key, _, _, _ = config
    stripe.api_key = secret_key

    result = await db.execute(
        select(Subscription)
        .where(
            Subscription.tenant_id == tenant_id,
            Subscription.is_active == True,  # noqa: E712
            Subscription.stripe_subscription_id.isnot(None),
        )
        .order_by(Subscription.created_at.desc())
        .limit(1)
    )
    sub = result.scalar_one_or_none()
    if not sub or not sub.stripe_subscription_id:
        return False

    try:
        if cancel_immediately:
            stripe.Subscription.delete(sub.stripe_subscription_id)
            sub.is_active = False
            sub.auto_renew = False
        else:
            stripe.Subscription.modify(sub.stripe_subscription_id, cancel_at_period_end=True)
            sub.auto_renew = False
        await db.flush()
        logger.info(
            "Stripe subscription %s canceled for tenant %s (immediate=%s)",
            sub.stripe_subscription_id, tenant_id, cancel_immediately,
        )
        return True
    except stripe.error.StripeError as e:
        logger.warning("Failed to cancel Stripe subscription %s: %s", sub.stripe_subscription_id, e)
        # Still update our DB so we don't try to process future renewals
        sub.auto_renew = False
        await db.flush()
        return True  # We did our best


async def refund_transaction(db: AsyncSession, transaction_id: str) -> dict:
    """
    Refund a succeeded payment via Stripe. Returns {"success": bool, "message": str}.
    """
    from app.models import PaymentTransaction
    config = await _get_stripe_config(db)
    if not config:
        return {"success": False, "message": "Stripe is not configured"}
    secret_key, _, _, _ = config
    stripe.api_key = secret_key

    result = await db.execute(
        select(PaymentTransaction).where(PaymentTransaction.id == transaction_id)
    )
    pt = result.scalar_one_or_none()
    if not pt:
        return {"success": False, "message": "Transaction not found"}
    if pt.status != "succeeded":
        return {"success": False, "message": f"Cannot refund transaction with status {pt.status}"}

    charge_id = None
    payment_intent_id = pt.stripe_payment_intent_id
    invoice_id = pt.stripe_invoice_id

    try:
        if payment_intent_id:
            pi = stripe.PaymentIntent.retrieve(payment_intent_id)
            if pi.charges and pi.charges.data:
                charge_id = pi.charges.data[0].id
        if not charge_id and invoice_id:
            inv = stripe.Invoice.retrieve(invoice_id)
            charge_id = inv.get("charge") if isinstance(inv.get("charge"), str) else (inv.charge.id if inv.charge else None)
        if not charge_id:
            return {"success": False, "message": "No Stripe charge found for this transaction"}

        stripe.Refund.create(charge=charge_id, reason="requested_by_customer")
        pt.status = "refunded"
        await db.flush()
        logger.info("Refunded transaction %s (charge %s)", transaction_id, charge_id)
        return {"success": True, "message": "Refund successful"}
    except stripe.error.StripeError as e:
        logger.warning("Stripe refund failed for %s: %s", transaction_id, e)
        return {"success": False, "message": str(e)}


async def recharge_transaction(db: AsyncSession, transaction_id: str) -> dict:
    """
    Retry charging for a failed payment, or create new charge for same amount (e.g. for extension).
    Returns {"success": bool, "message": str}.
    """
    from app.models import PaymentTransaction
    config = await _get_stripe_config(db)
    if not config:
        return {"success": False, "message": "Stripe is not configured"}
    secret_key, _, _, _ = config
    stripe.api_key = secret_key

    result = await db.execute(
        select(PaymentTransaction, Tenant, Plan)
        .outerjoin(Tenant, PaymentTransaction.tenant_id == Tenant.id)
        .outerjoin(Plan, PaymentTransaction.plan_id == Plan.id)
        .where(PaymentTransaction.id == transaction_id)
    )
    row = result.one_or_none()
    if not row:
        return {"success": False, "message": "Transaction not found"}
    pt, tenant, plan = row
    if not tenant:
        return {"success": False, "message": "Tenant not found"}
    if not tenant.stripe_customer_id:
        return {"success": False, "message": "Tenant has no saved payment method"}

    amount_cents = int(float(pt.amount) * 100)
    currency = (pt.currency or "usd").lower()

    try:
        # Try to pay latest open invoice for subscription first
        sub_result = await db.execute(
            select(Subscription)
            .where(
                Subscription.tenant_id == pt.tenant_id,
                Subscription.is_active == True,  # noqa: E712
                Subscription.stripe_subscription_id.isnot(None),
            )
            .order_by(Subscription.created_at.desc())
            .limit(1)
        )
        sub = sub_result.scalar_one_or_none()
        if sub and sub.stripe_subscription_id:
            try:
                inv = stripe.Invoice.list(subscription=sub.stripe_subscription_id, status="open", limit=1)
                if inv.data:
                    paid = stripe.Invoice.pay(inv.data[0].id)
                    if paid.status == "paid":
                        inv_obj = stripe.Invoice.retrieve(paid.id)
                        inv_dict = {"id": inv_obj.id, "subscription": inv_obj.subscription, "billing_reason": "subscription_cycle", "amount_paid": inv_obj.amount_paid, "currency": inv_obj.currency}
                        await handle_invoice_paid(db, inv_dict)
                        return {"success": True, "message": "Payment successful"}
                # Create and pay new invoice for subscription
                new_inv = stripe.Invoice.create(customer=tenant.stripe_customer_id, subscription=sub.stripe_subscription_id)
                if new_inv.status == "draft":
                    new_inv = stripe.Invoice.finalize_invoice(new_inv.id)
                paid = stripe.Invoice.pay(new_inv.id)
                if paid.status == "paid":
                    inv_obj = stripe.Invoice.retrieve(paid.id)
                    inv_dict = {"id": inv_obj.id, "subscription": inv_obj.subscription, "billing_reason": "subscription_cycle", "amount_paid": inv_obj.amount_paid, "currency": inv_obj.currency}
                    await handle_invoice_paid(db, inv_dict)
                    return {"success": True, "message": "Payment successful"}
            except stripe.error.StripeError as e:
                pass  # Fall through to one-time charge

        # One-time charge via PaymentIntent
        pi = stripe.PaymentIntent.create(
            amount=amount_cents,
            currency=currency,
            customer=tenant.stripe_customer_id,
            confirm=True,
            automatic_payment_methods={"enabled": True},
            metadata={"tenant_id": str(pt.tenant_id), "plan_id": str(pt.plan_id or ""), "recharge_of": transaction_id},
        )
        if pi.status == "succeeded":
            now = utcnow_naive()
            new_pt = PaymentTransaction(
                id=generate_uuid(),
                tenant_id=pt.tenant_id,
                company_name=pt.company_name,
                plan_id=pt.plan_id,
                stripe_payment_intent_id=pi.id,
                stripe_invoice_id=None,
                amount=pt.amount,
                currency=pt.currency or "USD",
                status="succeeded",
                created_at=now,
            )
            db.add(new_pt)
            if plan and pt.tenant_id:
                from sqlalchemy import update
                await db.execute(
                    update(Subscription)
                    .where(Subscription.tenant_id == pt.tenant_id)
                    .values(is_active=False)
                )
                dur = plan.duration_days or 30
                new_sub = Subscription(
                    id=generate_uuid(),
                    tenant_id=pt.tenant_id,
                    plan_id=str(plan.id),
                    is_active=True,
                    starts_at=now,
                    expires_at=now + timedelta(days=dur),
                    auto_renew=False,
                    created_at=now,
                )
                db.add(new_sub)
                await db.flush()
            return {"success": True, "message": "Payment successful"}
        return {"success": False, "message": pi.last_payment_error.message if pi.last_payment_error else "Payment failed"}
    except stripe.error.StripeError as e:
        logger.warning("Stripe recharge failed for %s: %s", transaction_id, e)
        return {"success": False, "message": str(e)}


async def handle_subscription_updated(db: AsyncSession, subscription: dict) -> None:
    """
    Handle customer.subscription.updated and customer.subscription.deleted.
    When subscription is cancelled or past_due, update our Subscription.
    """
    sub_id = subscription.get("id")
    status = subscription.get("status")
    cancel_at_period_end = subscription.get("cancel_at_period_end", False)

    result = await db.execute(
        select(Subscription).where(Subscription.stripe_subscription_id == sub_id)
    )
    sub = result.scalar_one_or_none()
    if not sub:
        return

    if status in ("canceled", "unpaid", "incomplete_expired"):
        sub.is_active = False
        sub.auto_renew = False
        await db.flush()
        logger.info("Subscription %s deactivated (status=%s)", sub_id, status)
    elif cancel_at_period_end:
        sub.auto_renew = False
        await db.flush()
        logger.info("Subscription %s set to cancel at period end", sub_id)
