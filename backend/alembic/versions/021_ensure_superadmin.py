"""Ensure platform superadmin exists and has correct credentials.

Fixes superadmin login when the account was deleted, corrupted, or overwritten.
Username: superadmin, Password: superadmin

Revision ID: 021
Revises: 020
Create Date: 2026-02-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "021"
down_revision: Union[str, None] = "020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SUPERADMIN_ID = "00000000-0000-0000-0000-000000000001"
# bcrypt hash of "superadmin"
SUPERADMIN_HASH = "$2b$12$yqQ4mn5ZvAlfjZkRfjI.Ju6051n0ezgB3dL3qL3gswK1otpbXNsVi"


def upgrade() -> None:
    conn = op.get_bind()
    # Upsert: insert or update superadmin so it always has correct credentials
    conn.execute(sa.text("""
        INSERT INTO users
        (id, email, username, full_name, hashed_password, is_active, is_superuser,
         email_verified, phone_verified, onboarding_completed, totp_enabled,
         tenant_id, created_at, updated_at)
        VALUES (:id, :email, :username, :full_name, :hashed_password, true, true,
                true, false, true, false,
                NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (username) DO UPDATE SET
            email = EXCLUDED.email,
            hashed_password = EXCLUDED.hashed_password,
            is_active = true,
            is_superuser = true,
            email_verified = true,
            phone_verified = false,
            onboarding_completed = true,
            totp_enabled = false,
            totp_secret = NULL,
            tenant_id = NULL,
            updated_at = CURRENT_TIMESTAMP
    """), {
        "id": SUPERADMIN_ID,
        "email": "superadmin@sshcontrol.local",
        "username": "superadmin",
        "full_name": "Platform Superadmin",
        "hashed_password": SUPERADMIN_HASH,
    })


def downgrade() -> None:
    pass  # Do not remove superadmin on downgrade
