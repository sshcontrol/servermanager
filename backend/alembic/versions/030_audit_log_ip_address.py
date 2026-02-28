"""Add ip_address to audit_log for client IP tracking

Revision ID: 030
Revises: 029
Create Date: 2026-02-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "030"
down_revision: Union[str, None] = "029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("audit_log", sa.Column("ip_address", sa.String(45), nullable=True))


def downgrade() -> None:
    op.drop_column("audit_log", "ip_address")
