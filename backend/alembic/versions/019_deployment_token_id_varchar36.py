"""Fix deployment_token.id column: VARCHAR(1) -> VARCHAR(36) for UUID support

Signup creates per-tenant DeploymentToken with UUID id; legacy schema had id as VARCHAR(1).
This migration alters the column so inserts succeed.

Revision ID: 019
Revises: 018
Create Date: 2026-02-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "019"
down_revision: Union[str, None] = "018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    r = conn.execute(sa.text(
        "SELECT character_maximum_length FROM information_schema.columns "
        "WHERE table_name = 'deployment_token' AND column_name = 'id'"
    )).fetchone()
    if r and r[0] == 1:
        op.execute(sa.text(
            "ALTER TABLE deployment_token ALTER COLUMN id TYPE character varying(36)"
        ))


def downgrade() -> None:
    # Downgrade would truncate UUIDs; not safe if multi-tenant tokens exist
    pass
