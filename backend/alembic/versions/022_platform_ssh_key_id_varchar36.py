"""Fix platform_ssh_key.id column: VARCHAR(1) -> VARCHAR(36) for UUID support

Generate key creates a new PlatformSSHKey with UUID id; legacy schema had id as VARCHAR(1).
This migration alters the column so inserts succeed.

Revision ID: 022
Revises: 021
Create Date: 2026-02-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "022"
down_revision: Union[str, None] = "021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    r = conn.execute(sa.text(
        "SELECT character_maximum_length FROM information_schema.columns "
        "WHERE table_name = 'platform_ssh_key' AND column_name = 'id'"
    )).fetchone()
    if r and r[0] == 1:
        op.execute(sa.text(
            "ALTER TABLE platform_ssh_key ALTER COLUMN id TYPE character varying(36)"
        ))


def downgrade() -> None:
    pass
