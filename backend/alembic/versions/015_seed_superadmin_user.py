"""Seed platform superadmin user (username: superadmin, password: superadmin)

Revision ID: 015
Revises: 014
Create Date: 2026-02-09

"""
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa

revision: str = "015"
down_revision: Union[str, None] = "014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SUPERADMIN_ID = "00000000-0000-0000-0000-000000000001"
# bcrypt hash of "superadmin"
SUPERADMIN_HASH = "$2b$12$yqQ4mn5ZvAlfjZkRfjI.Ju6051n0ezgB3dL3qL3gswK1otpbXNsVi"


def upgrade() -> None:
    op.execute(sa.text(
        "INSERT INTO users "
        "(id, email, username, full_name, hashed_password, is_active, is_superuser, "
        " email_verified, phone_verified, onboarding_completed, totp_enabled, "
        " tenant_id, created_at, updated_at) "
        "VALUES (:id, :email, :username, :full_name, :hashed_password, true, true, "
        "        true, false, true, false, "
        "        NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) "
        "ON CONFLICT (username) DO NOTHING"
    ).bindparams(
        id=SUPERADMIN_ID,
        email="superadmin@sshcontrol.local",
        username="superadmin",
        full_name="Platform Superadmin",
        hashed_password=SUPERADMIN_HASH,
    ))


def downgrade() -> None:
    op.execute(sa.text(
        "DELETE FROM users WHERE id = :id"
    ).bindparams(id=SUPERADMIN_ID))
