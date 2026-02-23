"""Enable email sending by default so verification emails are sent on signup.

Superadmin can still disable via the Email settings panel.
API key must be set (in superadmin or SENDGRID_API_KEY env) for emails to actually send.

Revision ID: 020
Revises: 019
Create Date: 2026-02-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "020"
down_revision: Union[str, None] = "019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text(
        "UPDATE email_settings SET enabled = true WHERE id = '1'"
    ))


def downgrade() -> None:
    op.execute(sa.text(
        "UPDATE email_settings SET enabled = false WHERE id = '1'"
    ))
