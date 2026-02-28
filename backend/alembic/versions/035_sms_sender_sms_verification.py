"""Add sender_name to smpp_settings, sms_verification_enabled to users, phone_verification_tokens table

Revision ID: 035
Revises: 034
Create Date: 2026-02-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "035"
down_revision: Union[str, None] = "034"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("smpp_settings", sa.Column("sender_name", sa.String(50), nullable=False, server_default="SSHCONTROL"))
    op.add_column("users", sa.Column("sms_verification_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))

    op.create_table(
        "phone_verification_tokens",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("phone", sa.String(20), nullable=False),
        sa.Column("code", sa.String(10), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "login_sms_tokens",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("code", sa.String(10), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("login_sms_tokens")
    op.drop_table("phone_verification_tokens")
    op.drop_column("users", "sms_verification_enabled")
    op.drop_column("smpp_settings", "sender_name")
