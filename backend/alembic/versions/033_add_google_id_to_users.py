"""Add google_id to users for Google OAuth linking

Revision ID: 033
Revises: 032
Create Date: 2026-02-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "033"
down_revision: Union[str, None] = "032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("google_id", sa.String(64), nullable=True, index=True))


def downgrade() -> None:
    op.drop_column("users", "google_id")
