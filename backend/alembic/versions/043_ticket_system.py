"""Add ticket system tables

Revision ID: 043
Revises: 042
Create Date: 2026-03-19

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "043"
down_revision: Union[str, None] = "042"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    ticket_number_seq = sa.Sequence("ticket_number_seq")
    op.execute(sa.schema.CreateSequence(ticket_number_seq))

    op.create_table(
        "tickets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("ticket_number", sa.Integer, ticket_number_seq, unique=True, nullable=False, server_default=ticket_number_seq.next_value()),
        sa.Column("tenant_id", sa.String(36), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("category", sa.String(50), nullable=False, server_default="general"),
        sa.Column("priority", sa.String(20), nullable=False, server_default="medium"),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=True),
        sa.Column("closed_at", sa.DateTime, nullable=True),
    )

    op.create_table(
        "ticket_messages",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("ticket_id", sa.String(36), sa.ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("message", sa.Text, nullable=False),
        sa.Column("is_staff_reply", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("attachment_url", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("ticket_messages")
    op.drop_table("tickets")
    op.execute(sa.schema.DropSequence(sa.Sequence("ticket_number_seq")))
