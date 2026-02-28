"""Add overdue_reminder_email to platform_settings for overdue payment alerts

Revision ID: 040
Revises: 039
Create Date: 2026-02-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "040"
down_revision: Union[str, None] = "039"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "platform_settings",
        sa.Column("overdue_reminder_email", sa.String(255), nullable=False, server_default="info@sshcontrol.com"),
    )


def downgrade() -> None:
    op.drop_column("platform_settings", "overdue_reminder_email")
