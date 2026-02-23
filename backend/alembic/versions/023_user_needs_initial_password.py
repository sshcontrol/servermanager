"""Add needs_initial_password to users for invitation flow

Invited users are created with a temporary password; they set their real password
on the Welcome page as the first onboarding step.

Revision ID: 023
Revises: 022
Create Date: 2026-02-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "023"
down_revision: Union[str, None] = "022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("needs_initial_password", sa.Boolean(), nullable=False, server_default="false"))


def downgrade() -> None:
    op.drop_column("users", "needs_initial_password")
