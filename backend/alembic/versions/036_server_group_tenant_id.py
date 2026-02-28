"""Add tenant_id to server_groups for tenant-scoped groups

Revision ID: 036
Revises: 035
Create Date: 2026-02-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "036"
down_revision: Union[str, None] = "035"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("server_groups", sa.Column("tenant_id", sa.String(36), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True))

    # Backfill tenant_id from first server in group, or from first user in access
    op.execute(sa.text("""
        UPDATE server_groups sg
        SET tenant_id = (
            SELECT s.tenant_id FROM server_group_servers sgs
            JOIN servers s ON s.id = sgs.server_id
            WHERE sgs.server_group_id = sg.id AND s.tenant_id IS NOT NULL
            LIMIT 1
        )
        WHERE sg.tenant_id IS NULL
    """))
    op.execute(sa.text("""
        UPDATE server_groups sg
        SET tenant_id = (
            SELECT u.tenant_id FROM server_group_access sga
            JOIN users u ON u.id = sga.user_id
            WHERE sga.server_group_id = sg.id AND u.tenant_id IS NOT NULL
            LIMIT 1
        )
        WHERE sg.tenant_id IS NULL
    """))

    # Unique constraint: (tenant_id, name) - allow same name in different tenants
    op.create_unique_constraint(
        "uq_server_groups_tenant_name",
        "server_groups",
        ["tenant_id", "name"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_server_groups_tenant_name", "server_groups", type_="unique")
    op.drop_column("server_groups", "tenant_id")
