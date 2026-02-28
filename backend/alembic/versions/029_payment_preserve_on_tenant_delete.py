"""Preserve payment history when tenant is deleted

Revision ID: 029
Revises: 028
Create Date: 2026-02-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "029"
down_revision: Union[str, None] = "028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add company_name to preserve tenant name when tenant is deleted
    op.add_column("payment_transactions", sa.Column("company_name", sa.String(255), nullable=True))

    # Backfill company_name from tenants for existing records (works with PostgreSQL and SQLite)
    op.execute("""
        UPDATE payment_transactions
        SET company_name = (SELECT company_name FROM tenants WHERE tenants.id = payment_transactions.tenant_id)
        WHERE tenant_id IS NOT NULL AND company_name IS NULL
    """)

    # Drop the CASCADE FK and recreate with SET NULL
    op.drop_constraint("payment_transactions_tenant_id_fkey", "payment_transactions", type_="foreignkey")
    op.alter_column(
        "payment_transactions",
        "tenant_id",
        existing_type=sa.String(36),
        nullable=True,
    )
    op.create_foreign_key(
        "payment_transactions_tenant_id_fkey",
        "payment_transactions",
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("payment_transactions_tenant_id_fkey", "payment_transactions", type_="foreignkey")
    op.alter_column(
        "payment_transactions",
        "tenant_id",
        existing_type=sa.String(36),
        nullable=False,
    )
    op.create_foreign_key(
        "payment_transactions_tenant_id_fkey",
        "payment_transactions",
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.drop_column("payment_transactions", "company_name")
