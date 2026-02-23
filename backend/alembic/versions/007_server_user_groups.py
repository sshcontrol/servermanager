"""Add server_groups, user_groups, and group access tables

Revision ID: 007
Revises: 006
Create Date: 2025-02-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Server groups: group of servers; admin can assign users to group (role on all servers in group)
    op.create_table(
        "server_groups",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False, index=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    # Which servers belong to a server group
    op.create_table(
        "server_group_servers",
        sa.Column("server_group_id", sa.String(36), sa.ForeignKey("server_groups.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("server_id", sa.String(36), sa.ForeignKey("servers.id", ondelete="CASCADE"), primary_key=True),
    )
    # User has role on all servers in this server group
    op.create_table(
        "server_group_access",
        sa.Column("server_group_id", sa.String(36), sa.ForeignKey("server_groups.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )

    # User groups: group of users; admin can assign user group to a server (all users get that role on server)
    op.create_table(
        "user_groups",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False, index=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    # Which users belong to a user group
    op.create_table(
        "user_group_members",
        sa.Column("user_group_id", sa.String(36), sa.ForeignKey("user_groups.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    )
    # User group has role on this server (all members get access)
    op.create_table(
        "server_user_group_access",
        sa.Column("server_id", sa.String(36), sa.ForeignKey("servers.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_group_id", sa.String(36), sa.ForeignKey("user_groups.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("server_user_group_access")
    op.drop_table("user_group_members")
    op.drop_table("user_groups")
    op.drop_table("server_group_access")
    op.drop_table("server_group_servers")
    op.drop_table("server_groups")
