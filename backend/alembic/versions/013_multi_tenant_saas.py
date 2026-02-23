"""Multi-tenant SaaS: plans, tenants, subscriptions, email/password tokens, tenant_id on existing tables

Revision ID: 013
Revises: 012
Create Date: 2026-02-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "013"
down_revision: Union[str, None] = "012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # Drop legacy FK from organizations -> plans (old schema being replaced by tenants)
    orgs_exists = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
        "WHERE table_schema='public' AND table_name='organizations')"
    )).scalar()
    if orgs_exists:
        conn.execute(sa.text(
            "ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_plan_id_fkey"
        ))

    # Drop legacy plans table if it exists with an incompatible schema
    plans_exists = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
        "WHERE table_schema='public' AND table_name='plans')"
    )).scalar()
    if plans_exists:
        conn.execute(sa.text("DROP TABLE plans CASCADE"))

    # Plans
    op.create_table(
        "plans",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(100), unique=True, nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("price", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
        sa.Column("duration_days", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("duration_label", sa.String(50), nullable=False, server_default="1 month"),
        sa.Column("max_users", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("max_servers", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("is_free", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    # Seed the free plan
    op.execute(sa.text("""
        INSERT INTO plans (id, name, description, price, currency, duration_days, duration_label,
                           max_users, max_servers, is_free, is_active, sort_order, created_at, updated_at)
        VALUES ('free-plan-0001', 'Free', 'Free starter plan', 0, 'USD', 36500, 'Lifetime',
                3, 5, true, true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    """))

    # Tenants
    op.create_table(
        "tenants",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("company_name", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("owner_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )

    # Subscriptions
    op.create_table(
        "subscriptions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("plan_id", sa.String(36), sa.ForeignKey("plans.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("starts_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_subscriptions_tenant_id", "subscriptions", ["tenant_id"])
    op.create_index("ix_subscriptions_plan_id", "subscriptions", ["plan_id"])

    # Email verification tokens
    op.create_table(
        "email_verification_tokens",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token", sa.String(128), unique=True, nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_email_verification_tokens_token", "email_verification_tokens", ["token"])
    op.create_index("ix_email_verification_tokens_user_id", "email_verification_tokens", ["user_id"])

    # Password reset tokens
    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token", sa.String(128), unique=True, nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_password_reset_tokens_token", "password_reset_tokens", ["token"])
    op.create_index("ix_password_reset_tokens_user_id", "password_reset_tokens", ["user_id"])

    # Add tenant_id to users
    op.add_column("users", sa.Column("tenant_id", sa.String(36), nullable=True))
    op.add_column("users", sa.Column("full_name", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("users", sa.Column("phone_verified", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("onboarding_completed", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.create_index("ix_users_tenant_id", "users", ["tenant_id"])
    op.create_foreign_key("fk_users_tenant_id", "users", "tenants", ["tenant_id"], ["id"], ondelete="CASCADE")

    # Add tenant_id to servers
    op.add_column("servers", sa.Column("tenant_id", sa.String(36), nullable=True))
    op.create_index("ix_servers_tenant_id", "servers", ["tenant_id"])
    op.create_foreign_key("fk_servers_tenant_id", "servers", "tenants", ["tenant_id"], ["id"], ondelete="CASCADE")

    # Migrate platform_ssh_key: change PK from single char to UUID, add tenant_id
    op.add_column("platform_ssh_key", sa.Column("tenant_id", sa.String(36), nullable=True))
    op.create_index("ix_platform_ssh_key_tenant_id", "platform_ssh_key", ["tenant_id"])

    # Migrate deployment_token: change PK from single char to UUID, add tenant_id
    op.add_column("deployment_token", sa.Column("tenant_id", sa.String(36), nullable=True))
    op.create_index("ix_deployment_token_tenant_id", "deployment_token", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_deployment_token_tenant_id", "deployment_token")
    op.drop_column("deployment_token", "tenant_id")

    op.drop_index("ix_platform_ssh_key_tenant_id", "platform_ssh_key")
    op.drop_column("platform_ssh_key", "tenant_id")

    op.drop_constraint("fk_servers_tenant_id", "servers", type_="foreignkey")
    op.drop_index("ix_servers_tenant_id", "servers")
    op.drop_column("servers", "tenant_id")

    op.drop_constraint("fk_users_tenant_id", "users", type_="foreignkey")
    op.drop_index("ix_users_tenant_id", "users")
    op.drop_column("users", "onboarding_completed")
    op.drop_column("users", "phone_verified")
    op.drop_column("users", "email_verified")
    op.drop_column("users", "full_name")
    op.drop_column("users", "tenant_id")

    op.drop_index("ix_password_reset_tokens_user_id", "password_reset_tokens")
    op.drop_index("ix_password_reset_tokens_token", "password_reset_tokens")
    op.drop_table("password_reset_tokens")

    op.drop_index("ix_email_verification_tokens_user_id", "email_verification_tokens")
    op.drop_index("ix_email_verification_tokens_token", "email_verification_tokens")
    op.drop_table("email_verification_tokens")

    op.drop_index("ix_subscriptions_plan_id", "subscriptions")
    op.drop_index("ix_subscriptions_tenant_id", "subscriptions")
    op.drop_table("subscriptions")

    op.drop_table("tenants")
    op.drop_table("plans")
