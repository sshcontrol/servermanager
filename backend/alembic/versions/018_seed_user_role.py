"""Seed 'user' role with basic read permissions

Revision ID: 018
Revises: 017
Create Date: 2026-02-22

"""
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa

revision: str = "018"
down_revision: Union[str, None] = "017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _uuid():
    return str(uuid.uuid4())


def upgrade() -> None:
    conn = op.get_bind()

    # Create "user" role if it doesn't exist
    existing = conn.execute(sa.text("SELECT id FROM roles WHERE name = 'user' LIMIT 1")).fetchone()
    if existing:
        user_role_id = existing[0]
    else:
        user_role_id = _uuid()
        conn.execute(
            sa.text("INSERT INTO roles (id, name, description) VALUES (:id, :name, :desc)"),
            {"id": user_role_id, "name": "user", "desc": "Standard user with read access to servers"},
        )

    # Assign servers:read permission to user role
    perm = conn.execute(sa.text("SELECT id FROM permissions WHERE name = 'servers:read' LIMIT 1")).fetchone()
    if perm:
        conn.execute(
            sa.text(
                "INSERT INTO role_permissions (role_id, permission_id) VALUES (:rid, :pid) "
                "ON CONFLICT (role_id, permission_id) DO NOTHING"
            ),
            {"rid": user_role_id, "pid": perm[0]},
        )


def downgrade() -> None:
    conn = op.get_bind()
    user_role = conn.execute(sa.text("SELECT id FROM roles WHERE name = 'user' LIMIT 1")).fetchone()
    if user_role:
        conn.execute(sa.text("DELETE FROM role_permissions WHERE role_id = :rid"), {"rid": user_role[0]})
        conn.execute(sa.text("DELETE FROM user_roles WHERE role_id = :rid"), {"rid": user_role[0]})
        conn.execute(sa.text("DELETE FROM roles WHERE id = :rid"), {"rid": user_role[0]})
