"""Migrate server access role from admin to root (Linux terminology)

Server access roles represent Linux user types: root (sudo/elevated) vs user (regular).
Admin/user are control panel roles; root/user are for server assignment.

Revision ID: 041
Revises: 040
Create Date: 2026-03-02

"""
from typing import Sequence, Union

from alembic import op


revision: str = "041"
down_revision: Union[str, None] = "040"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE server_access SET role = 'root' WHERE role = 'admin'"
    )
    op.execute(
        "UPDATE server_group_access SET role = 'root' WHERE role = 'admin'"
    )
    op.execute(
        "UPDATE server_user_group_access SET role = 'root' WHERE role = 'admin'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE server_access SET role = 'admin' WHERE role = 'root'"
    )
    op.execute(
        "UPDATE server_group_access SET role = 'admin' WHERE role = 'root'"
    )
    op.execute(
        "UPDATE server_user_group_access SET role = 'admin' WHERE role = 'root'"
    )
