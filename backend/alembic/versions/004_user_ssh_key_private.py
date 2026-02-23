"""Add private_key_pem to user_ssh_keys for per-user key download

Revision ID: 004
Revises: 003
Create Date: 2025-01-31

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("user_ssh_keys", sa.Column("private_key_pem", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("user_ssh_keys", "private_key_pem")
