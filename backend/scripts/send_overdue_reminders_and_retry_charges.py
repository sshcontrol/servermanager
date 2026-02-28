"""
Send overdue payment reminders and retry Stripe charges for past-due subscriptions.
Run daily via cron: python -m scripts.send_overdue_reminders_and_retry_charges

- Sends daily email to overdue_reminder_email (e.g. info@sshcontrol.com) and to tenant admin
- Informs that account will be suspended after 10 days
- For auto_renew subscriptions: tries to charge via Stripe daily until payment received
- After 10 days overdue: suspends tenant (subscription.is_active=False, tenant.is_active=False)
"""
import asyncio
import os
import sys
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from app.config import get_settings
from app.models.platform_settings import PlatformSettings
from app.models.tenant import Subscription, Tenant, Plan
from app.models.user import User
from app.models.user import utcnow_naive
from app.services import email_service
from app.services.stripe_service import _get_stripe_config
import stripe


SUSPENSION_DAYS = 10


async def main():
    settings = get_settings()
    db_url = settings.database_url
    if not db_url.startswith("postgresql+asyncpg"):
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    engine = create_async_engine(db_url)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as db:
        r = await db.execute(select(PlatformSettings).where(PlatformSettings.id == "1"))
        cfg = r.scalar_one_or_none()
        if not cfg:
            print("Platform not configured")
            return

        overdue_email = getattr(cfg, "overdue_reminder_email", None) or "info@sshcontrol.com"
        stripe_config = await _get_stripe_config(db)
        stripe_enabled = bool(stripe_config)

        now = utcnow_naive()
        suspension_threshold = now - timedelta(days=SUSPENSION_DAYS)

        # Find overdue subscriptions (expires_at < now, plan not free)
        result = await db.execute(
            select(Subscription, Plan.name, Plan.is_free, Tenant.company_name, Tenant.billing_email, Tenant.owner_id, Tenant.is_active)
            .join(Plan, Subscription.plan_id == Plan.id)
            .join(Tenant, Subscription.tenant_id == Tenant.id)
            .where(
                Subscription.is_active == True,  # noqa: E712
                Subscription.expires_at.isnot(None),
                Subscription.expires_at < now,
                Plan.is_free == False,  # noqa: E712
            )
        )
        rows = result.all()

        for sub, plan_name, is_free, company_name, billing_email, owner_id, tenant_active in rows:
            expires_at = sub.expires_at
            days_overdue = (now - expires_at).days if expires_at else 0
            expires_str = expires_at.strftime("%Y-%m-%d") if expires_at else "N/A"
            days_until_suspension = max(0, SUSPENSION_DAYS - days_overdue)

            # 1. Suspend if overdue > 10 days
            if days_overdue >= SUSPENSION_DAYS:
                sub.is_active = False
                tenant = await db.get(Tenant, sub.tenant_id)
                if tenant:
                    tenant.is_active = False
                await db.flush()
                print(f"  Suspended tenant {sub.tenant_id} ({company_name}) - {days_overdue} days overdue")
                # Still send reminder
            else:
                # 2. Try Stripe charge if auto_renew and Stripe enabled
                if sub.auto_renew and stripe_enabled and sub.stripe_subscription_id:
                    try:
                        stripe.api_key = stripe_config[0]
                        inv_list = stripe.Invoice.list(subscription=sub.stripe_subscription_id, status="open", limit=1)
                        if inv_list.data:
                            paid = stripe.Invoice.pay(inv_list.data[0].id)
                            if paid.status == "paid":
                                from app.services.stripe_service import handle_invoice_paid
                                inv_obj = stripe.Invoice.retrieve(paid.id)
                                inv_dict = {
                                    "id": inv_obj.id,
                                    "subscription": inv_obj.subscription,
                                    "billing_reason": "subscription_cycle",
                                    "amount_paid": inv_obj.amount_paid,
                                    "currency": inv_obj.currency,
                                }
                                await handle_invoice_paid(db, inv_dict)
                                await db.commit()
                                print(f"  Charged tenant {sub.tenant_id} ({company_name}) - payment successful")
                                continue  # Skip reminder, payment succeeded
                    except stripe.error.StripeError as e:
                        print(f"  Stripe retry failed for {sub.tenant_id}: {e}")

            # 3. Send overdue reminder to platform email and admin
            admin_email = billing_email
            if not admin_email and owner_id:
                u = await db.execute(select(User.email).where(User.id == owner_id))
                admin_email = u.scalar_one_or_none()

            if overdue_email:
                await email_service.send_overdue_reminder_email(
                    db,
                    to_email=overdue_email,
                    company_name=company_name or "",
                    plan_name=plan_name or "Plan",
                    expires_at=expires_str,
                    days_overdue=days_overdue,
                    days_until_suspension=days_until_suspension,
                )
                print(f"  Overdue reminder to {overdue_email} for {company_name}")

            if admin_email and admin_email != overdue_email:
                await email_service.send_overdue_reminder_email(
                    db,
                    to_email=admin_email,
                    company_name=company_name or "",
                    plan_name=plan_name or "Plan",
                    expires_at=expires_str,
                    days_overdue=days_overdue,
                    days_until_suspension=days_until_suspension,
                )
                print(f"  Overdue reminder to admin {admin_email} for {company_name}")

        await db.commit()
        print(f"Overdue reminders and retries processed. Checked {len(rows)} overdue subscriptions.")


if __name__ == "__main__":
    asyncio.run(main())
