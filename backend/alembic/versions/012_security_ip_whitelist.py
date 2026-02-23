"""Security: IP whitelist settings and entries

Revision ID: 012
Revises: 011
Create Date: 2025-02-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "012"
down_revision: Union[str, None] = "011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ip_whitelist_settings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.execute(
        sa.text("INSERT INTO ip_whitelist_settings (id, enabled, updated_at) VALUES ('1', false, CURRENT_TIMESTAMP)")
    )

    op.create_table(
        "ip_whitelist_entries",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("ip_address", sa.String(45), nullable=False),
        sa.Column("scope", sa.String(20), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_ip_whitelist_entries_ip_address", "ip_whitelist_entries", ["ip_address"])
    op.create_index("ix_ip_whitelist_entries_user_id", "ip_whitelist_entries", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_ip_whitelist_entries_user_id", "ip_whitelist_entries")
    op.drop_index("ix_ip_whitelist_entries_ip_address", "ip_whitelist_entries")
    op.drop_table("ip_whitelist_entries")
    op.drop_table("ip_whitelist_settings")
