"""Add tenant_id to IP whitelist tables for tenant isolation

Revision ID: 017
Revises: 016
Create Date: 2026-02-22

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "017"
down_revision: Union[str, None] = "016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # Add tenant_id to ip_whitelist_settings
    col_exists = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
        "WHERE table_name='ip_whitelist_settings' AND column_name='tenant_id')"
    )).scalar()
    if not col_exists:
        op.add_column("ip_whitelist_settings", sa.Column(
            "tenant_id", sa.String(36),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=True, index=True,
        ))

    # Add tenant_id to ip_whitelist_entries
    col_exists2 = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
        "WHERE table_name='ip_whitelist_entries' AND column_name='tenant_id')"
    )).scalar()
    if not col_exists2:
        op.add_column("ip_whitelist_entries", sa.Column(
            "tenant_id", sa.String(36),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=True, index=True,
        ))


def downgrade() -> None:
    op.drop_column("ip_whitelist_entries", "tenant_id")
    op.drop_column("ip_whitelist_settings", "tenant_id")
