"""Add reCAPTCHA site key and secret key to platform_settings

Revision ID: 031
Revises: 030
Create Date: 2026-02-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "031"
down_revision: Union[str, None] = "030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("platform_settings", sa.Column("recaptcha_site_key", sa.String(100), nullable=False, server_default=""))
    op.add_column("platform_settings", sa.Column("recaptcha_secret_key", sa.String(255), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("platform_settings", "recaptcha_secret_key")
    op.drop_column("platform_settings", "recaptcha_site_key")
