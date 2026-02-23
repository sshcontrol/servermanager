"""Seed default permissions and admin role

Revision ID: 002
Revises: 001
Create Date: 2025-01-31

"""
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _uuid():
    return str(uuid.uuid4())


def upgrade() -> None:
    conn = op.get_bind()
    # Insert default permissions
    permissions = [
        (_uuid(), "users:read", "users", "read", "View users"),
        (_uuid(), "users:write", "users", "write", "Create/update/delete users"),
        (_uuid(), "roles:read", "roles", "read", "View roles and permissions"),
        (_uuid(), "roles:write", "roles", "write", "Create/update/delete roles"),
        (_uuid(), "servers:read", "servers", "read", "View servers"),
        (_uuid(), "servers:write", "servers", "write", "Manage servers"),
    ]
    for pid, name, resource, action, desc in permissions:
        conn.execute(
            sa.text(
                "INSERT INTO permissions (id, name, resource, action, description) "
                "VALUES (:id, :name, :resource, :action, :desc) "
                "ON CONFLICT (name) DO NOTHING"
            ),
            {"id": pid, "name": name, "resource": resource, "action": action, "desc": desc},
        )
    # Note: PostgreSQL INSERT ... ON CONFLICT requires unique constraint on (name).
    # We have unique on name, so this is safe. If running twice, we skip duplicates.

    # Insert admin role with all permissions
    admin_role_id = _uuid()
    conn.execute(
        sa.text("INSERT INTO roles (id, name, description) VALUES (:id, :name, :desc) ON CONFLICT (name) DO NOTHING"),
        {"id": admin_role_id, "name": "admin", "desc": "Full access"},
    )
    # Get admin role id in case it already existed
    r = conn.execute(sa.text("SELECT id FROM roles WHERE name = 'admin' LIMIT 1"))
    row = r.fetchone()
    if row:
        admin_role_id = row[0]
    r = conn.execute(sa.text("SELECT id FROM permissions"))
    for (perm_id,) in r:
        conn.execute(
            sa.text(
                "INSERT INTO role_permissions (role_id, permission_id) VALUES (:rid, :pid) "
                "ON CONFLICT (role_id, permission_id) DO NOTHING"
            ),
            {"rid": admin_role_id, "pid": perm_id},
        )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name = 'admin')"))
    op.execute(sa.text("DELETE FROM roles WHERE name = 'admin'"))
    op.execute(
        sa.text(
            "DELETE FROM permissions WHERE name IN "
            "('users:read','users:write','roles:read','roles:write','servers:read','servers:write')"
        )
    )
