"""Add audit_log table for history

Revision ID: 006
Revises: 005
Create Date: 2025-01-31

"""
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "audit_log",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("action", sa.String(80), nullable=False, index=True),
        sa.Column("resource_type", sa.String(40), nullable=True, index=True),
        sa.Column("resource_id", sa.String(36), nullable=True, index=True),
        sa.Column("user_id", sa.String(36), nullable=True, index=True),
        sa.Column("username", sa.String(255), nullable=True),
        sa.Column("details", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("audit_log")
