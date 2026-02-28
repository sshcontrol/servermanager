"""Add SMPP settings and callbacks tables for SMS integration

Revision ID: 034
Revises: 033
Create Date: 2026-02-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "034"
down_revision: Union[str, None] = "033"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "smpp_settings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("link", sa.String(500), nullable=False, server_default=""),
        sa.Column("username", sa.String(255), nullable=False, server_default=""),
        sa.Column("password", sa.String(255), nullable=False, server_default=""),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.execute(
        "INSERT INTO smpp_settings (id, link, username, password, enabled, updated_at) "
        "VALUES ('1', '', '', '', false, NOW())"
    )

    op.create_table(
        "smpp_callbacks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("callback_type", sa.String(50), nullable=False, server_default=""),
        sa.Column("message_id", sa.String(255), nullable=True),
        sa.Column("status", sa.String(50), nullable=True),
        sa.Column("raw_payload", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_smpp_callbacks_created_at", "smpp_callbacks", ["created_at"])
    op.create_index("ix_smpp_callbacks_message_id", "smpp_callbacks", ["message_id"])


def downgrade() -> None:
    op.drop_index("ix_smpp_callbacks_message_id", table_name="smpp_callbacks")
    op.drop_index("ix_smpp_callbacks_created_at", table_name="smpp_callbacks")
    op.drop_table("smpp_callbacks")
    op.drop_table("smpp_settings")
