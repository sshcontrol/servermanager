"""Update superadmin email to info@sshcontrol.com

Revision ID: 032
Revises: 031
Create Date: 2026-02-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "032"
down_revision: Union[str, None] = "031"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SUPERADMIN_ID = "00000000-0000-0000-0000-000000000001"


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text("UPDATE users SET email = :email, updated_at = CURRENT_TIMESTAMP WHERE id = :id"),
        {"email": "info@sshcontrol.com", "id": SUPERADMIN_ID},
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text("UPDATE users SET email = :email, updated_at = CURRENT_TIMESTAMP WHERE id = :id"),
        {"email": "superadmin@sshcontrol.local", "id": SUPERADMIN_ID},
    )
