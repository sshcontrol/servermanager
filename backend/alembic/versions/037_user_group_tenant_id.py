"""Add tenant_id to user_groups for tenant-scoped groups

Revision ID: 037
Revises: 036
Create Date: 2026-02-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "037"
down_revision: Union[str, None] = "036"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("user_groups", sa.Column("tenant_id", sa.String(36), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True))

    # Backfill tenant_id from first member (user) in group
    op.execute(sa.text("""
        UPDATE user_groups ug
        SET tenant_id = (
            SELECT u.tenant_id FROM user_group_members ugm
            JOIN users u ON u.id = ugm.user_id
            WHERE ugm.user_group_id = ug.id AND u.tenant_id IS NOT NULL
            LIMIT 1
        )
        WHERE ug.tenant_id IS NULL
    """))
    # Fallback: from first server this group has access to
    op.execute(sa.text("""
        UPDATE user_groups ug
        SET tenant_id = (
            SELECT s.tenant_id FROM server_user_group_access suga
            JOIN servers s ON s.id = suga.server_id
            WHERE suga.user_group_id = ug.id AND s.tenant_id IS NOT NULL
            LIMIT 1
        )
        WHERE ug.tenant_id IS NULL
    """))

    # Unique constraint: (tenant_id, name) - allow same name in different tenants
    op.create_unique_constraint(
        "uq_user_groups_tenant_name",
        "user_groups",
        ["tenant_id", "name"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_user_groups_tenant_name", "user_groups", type_="unique")
    op.drop_column("user_groups", "tenant_id")
