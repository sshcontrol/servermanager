"""Add needs_initial_username to users for admin signup flow

Admins who sign up get username from email prefix; they set a proper username
on the Welcome page as the first onboarding step.

Revision ID: 024
Revises: 023
Create Date: 2026-02-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "024"
down_revision: Union[str, None] = "023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("needs_initial_username", sa.Boolean(), nullable=False, server_default="false"))


def downgrade() -> None:
    op.drop_column("users", "needs_initial_username")
