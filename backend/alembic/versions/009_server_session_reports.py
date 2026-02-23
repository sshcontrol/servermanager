"""Add server_session_reports for tracking which users are connected to which server (SSH sessions)

Revision ID: 009
Revises: 008
Create Date: 2025-02-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "server_session_reports",
        sa.Column("server_id", sa.String(36), sa.ForeignKey("servers.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("reported_at", sa.DateTime(), nullable=False),
        sa.Column("usernames", sa.Text(), nullable=False),
    )
    # usernames stored as JSON array of strings: ["aram", "nova", ...]


def downgrade() -> None:
    op.drop_table("server_session_reports")
