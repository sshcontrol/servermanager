"""
Send renewal reminder emails/notifications for subscriptions expiring soon.
Run daily via cron: python -m scripts.send_renewal_reminders

Uses platform_settings: renewal_reminder_days_before, renewal_reminder_send_email,
renewal_reminder_send_sms, renewal_reminder_send_notification.
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
from app.models.notification import Notification
from app.models.user import generate_uuid, utcnow_naive
from app.services import email_service
from app.services import sms_service


async def main():
    settings = get_settings()
    db_url = settings.database_url
    if not db_url.startswith("postgresql+asyncpg"):
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    engine = create_async_engine(db_url)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as db:
        # Get platform settings
        r = await db.execute(select(PlatformSettings).where(PlatformSettings.id == "1"))
        cfg = r.scalar_one_or_none()
        if not cfg:
            print("Platform not configured")
            return

        days_before = getattr(cfg, "renewal_reminder_days_before", 3) or 3
        send_email = getattr(cfg, "renewal_reminder_send_email", True)
        send_sms = getattr(cfg, "renewal_reminder_send_sms", False)
        send_notification = getattr(cfg, "renewal_reminder_send_notification", True)

        if not any([send_email, send_sms, send_notification]):
            print("All renewal reminder channels disabled")
            return

        now = utcnow_naive()
        window_start = now
        window_end = now + timedelta(days=days_before)

        # Find active subscriptions expiring within the window that haven't received a reminder
        result = await db.execute(
            select(Subscription, Plan.name, Tenant.company_name, Tenant.billing_email, Tenant.owner_id)
            .join(Plan, Subscription.plan_id == Plan.id)
            .join(Tenant, Subscription.tenant_id == Tenant.id)
            .where(
                Subscription.is_active == True,  # noqa: E712
                Subscription.expires_at.isnot(None),
                Subscription.expires_at >= window_start,
                Subscription.expires_at <= window_end,
                Subscription.renewal_reminder_sent_at.is_(None),
            )
        )
        rows = result.all()

        for sub, plan_name, company_name, billing_email, owner_id in rows:
            expires_at = sub.expires_at
            days_until = (expires_at - now).days if expires_at else 0
            expires_str = expires_at.strftime("%Y-%m-%d") if expires_at else "N/A"

            # Determine recipient email
            to_email = billing_email
            if not to_email and owner_id:
                u = await db.execute(select(User.email).where(User.id == owner_id))
                to_email = u.scalar_one_or_none()
            if not to_email:
                print(f"  Skip tenant {sub.tenant_id}: no email")
                continue

            sent_any = False

            if send_email and to_email:
                ok = await email_service.send_renewal_reminder_email(
                    db,
                    to_email=to_email,
                    company_name=company_name or "",
                    plan_name=plan_name or "Plan",
                    expires_at=expires_str,
                    days_until_expiry=days_until,
                )
                if ok:
                    sent_any = True
                    print(f"  Email sent to {to_email} (tenant {sub.tenant_id}, plan {plan_name})")

            if send_notification and owner_id:
                try:
                    n = Notification(
                        id=generate_uuid(),
                        recipient_id=str(owner_id),
                        sender_id=None,
                        subject="Subscription expiring soon",
                        message=f"Your {plan_name or 'Plan'} plan expires in {days_until} day(s) ({expires_str}).",
                        notification_type="payment_reminder",
                    )
                    db.add(n)
                    await db.flush()
                    sent_any = True
                    print(f"  Notification sent to owner (tenant {sub.tenant_id})")
                except Exception as e:
                    print(f"  Notification failed: {e}")

            if send_sms and owner_id:
                u = await db.execute(select(User.phone, User.phone_verified).where(User.id == owner_id))
                user_row = u.one_or_none()
                if user_row and user_row[0] and user_row[1]:
                    msg = f"SSHCONTROL: Your {plan_name or 'Plan'} plan expires in {days_until} days ({expires_str})."
                    sent, _ = await sms_service.send_sms(db, user_row[0], msg)
                    if sent:
                        sent_any = True
                        print(f"  SMS sent to owner (tenant {sub.tenant_id})")

            if sent_any:
                sub.renewal_reminder_sent_at = now
                await db.flush()

        await db.commit()
        print(f"Renewal reminders processed. Checked {len(rows)} subscriptions.")


if __name__ == "__main__":
    asyncio.run(main())
