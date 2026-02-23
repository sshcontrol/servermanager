"""Platform SSH key, servers, server_access, deployment_token

Revision ID: 003
Revises: 002
Create Date: 2025-01-31

"""
from typing import Sequence, Union
import secrets

from alembic import op
import sqlalchemy as sa

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "platform_ssh_key",
        sa.Column("id", sa.String(1), primary_key=True),
        sa.Column("private_key_pem", sa.Text(), nullable=False),
        sa.Column("public_key", sa.Text(), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "servers",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("hostname", sa.String(255), nullable=False),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_servers_hostname", "servers", ["hostname"], unique=False)

    op.create_table(
        "server_access",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("server_id", sa.String(36), sa.ForeignKey("servers.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "deployment_token",
        sa.Column("id", sa.String(1), primary_key=True),
        sa.Column("token", sa.String(64), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_deployment_token_token", "deployment_token", ["token"], unique=True)

    # Seed deployment token (one-time; use ON CONFLICT so re-run is safe)
    conn = op.get_bind()
    token = secrets.token_urlsafe(48)
    conn.execute(sa.text("INSERT INTO deployment_token (id, token) VALUES ('1', :t) ON CONFLICT (id) DO NOTHING"), {"t": token})


def downgrade() -> None:
    op.drop_table("server_access")
    op.drop_table("servers")
    op.drop_table("platform_ssh_key")
    op.drop_table("deployment_token")
