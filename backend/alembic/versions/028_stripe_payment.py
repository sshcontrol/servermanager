"""Stripe payment integration: keys, plan mapping, billing, renewal reminders

Revision ID: 028
Revises: 027
Create Date: 2026-02-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "028"
down_revision: Union[str, None] = "027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Platform settings: Stripe keys and renewal reminder config
    op.add_column("platform_settings", sa.Column("stripe_secret_key", sa.String(255), nullable=False, server_default=""))
    op.add_column("platform_settings", sa.Column("stripe_publishable_key", sa.String(255), nullable=False, server_default=""))
    op.add_column("platform_settings", sa.Column("stripe_webhook_secret", sa.String(255), nullable=False, server_default=""))
    op.add_column("platform_settings", sa.Column("stripe_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("platform_settings", sa.Column("renewal_reminder_days_before", sa.Integer(), nullable=False, server_default="3"))
    op.add_column("platform_settings", sa.Column("renewal_reminder_send_email", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("platform_settings", sa.Column("renewal_reminder_send_sms", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("platform_settings", sa.Column("renewal_reminder_send_notification", sa.Boolean(), nullable=False, server_default=sa.true()))

    # Plans: Stripe price ID for checkout
    op.add_column("plans", sa.Column("stripe_price_id", sa.String(255), nullable=True))

    # Tenants: Stripe customer, billing address
    op.add_column("tenants", sa.Column("stripe_customer_id", sa.String(255), nullable=True))
    op.add_column("tenants", sa.Column("billing_address", sa.Text(), nullable=True))  # JSON: {line1, line2, city, state, postal_code, country}
    op.add_column("tenants", sa.Column("billing_email", sa.String(255), nullable=True))  # For invoices
    op.add_column("tenants", sa.Column("receive_invoices", sa.Boolean(), nullable=False, server_default=sa.true()))

    # Subscriptions: Stripe link, auto-renew
    op.add_column("subscriptions", sa.Column("stripe_subscription_id", sa.String(255), nullable=True))
    op.add_column("subscriptions", sa.Column("auto_renew", sa.Boolean(), nullable=False, server_default=sa.false()))

    # Payment transactions (synced from Stripe webhooks / checkout)
    op.create_table(
        "payment_transactions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("plan_id", sa.String(36), sa.ForeignKey("plans.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("stripe_payment_intent_id", sa.String(255), nullable=True, index=True),
        sa.Column("stripe_invoice_id", sa.String(255), nullable=True, index=True),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
        sa.Column("status", sa.String(50), nullable=False),  # succeeded, failed, pending, refunded
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_payment_transactions_tenant_created", "payment_transactions", ["tenant_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_payment_transactions_tenant_created", "payment_transactions")
    op.drop_table("payment_transactions")
    op.drop_column("subscriptions", "auto_renew")
    op.drop_column("subscriptions", "stripe_subscription_id")
    op.drop_column("tenants", "receive_invoices")
    op.drop_column("tenants", "billing_email")
    op.drop_column("tenants", "billing_address")
    op.drop_column("tenants", "stripe_customer_id")
    op.drop_column("plans", "stripe_price_id")
    op.drop_column("platform_settings", "renewal_reminder_send_notification")
    op.drop_column("platform_settings", "renewal_reminder_send_sms")
    op.drop_column("platform_settings", "renewal_reminder_send_email")
    op.drop_column("platform_settings", "renewal_reminder_days_before")
    op.drop_column("platform_settings", "stripe_enabled")
    op.drop_column("platform_settings", "stripe_webhook_secret")
    op.drop_column("platform_settings", "stripe_publishable_key")
    op.drop_column("platform_settings", "stripe_secret_key")
