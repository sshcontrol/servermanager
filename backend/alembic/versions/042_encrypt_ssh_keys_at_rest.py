"""Encrypt SSH private keys at rest and add download window columns

- Add downloaded_at and download_expires_at columns to user_ssh_keys
- Encrypt all existing plaintext private keys (user + platform) using Fernet (ENCRYPTION_KEY)
- Set download_expires_at = now + 48h for existing keys that have a private key

Revision ID: 042
Revises: 041
Create Date: 2026-03-19

"""
import os
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from cryptography.fernet import Fernet


revision: str = "042"
down_revision: Union[str, None] = "041"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PREFIX = "enc:v1:"


def _get_fernet() -> Fernet:
    key = os.environ.get("ENCRYPTION_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "ENCRYPTION_KEY env var must be set before running this migration. "
            "Generate with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )
    return Fernet(key.encode())


def upgrade() -> None:
    op.add_column("user_ssh_keys", sa.Column("downloaded_at", sa.DateTime(), nullable=True))
    op.add_column("user_ssh_keys", sa.Column("download_expires_at", sa.DateTime(), nullable=True))

    conn = op.get_bind()
    f = _get_fernet()

    rows = conn.execute(
        sa.text("SELECT id, private_key_pem FROM user_ssh_keys WHERE private_key_pem IS NOT NULL")
    ).fetchall()
    for row in rows:
        if row.private_key_pem.startswith(PREFIX):
            continue
        encrypted = PREFIX + f.encrypt(row.private_key_pem.encode("utf-8")).decode("ascii")
        conn.execute(
            sa.text("UPDATE user_ssh_keys SET private_key_pem = :enc, download_expires_at = NOW() + INTERVAL '48 hours' WHERE id = :id"),
            {"enc": encrypted, "id": row.id},
        )

    rows = conn.execute(
        sa.text("SELECT id, private_key_pem FROM platform_ssh_key WHERE private_key_pem IS NOT NULL")
    ).fetchall()
    for row in rows:
        if row.private_key_pem.startswith(PREFIX):
            continue
        encrypted = PREFIX + f.encrypt(row.private_key_pem.encode("utf-8")).decode("ascii")
        conn.execute(
            sa.text("UPDATE platform_ssh_key SET private_key_pem = :enc WHERE id = :id"),
            {"enc": encrypted, "id": row.id},
        )


def downgrade() -> None:
    conn = op.get_bind()
    f = _get_fernet()

    rows = conn.execute(
        sa.text("SELECT id, private_key_pem FROM platform_ssh_key WHERE private_key_pem IS NOT NULL")
    ).fetchall()
    for row in rows:
        if not row.private_key_pem.startswith(PREFIX):
            continue
        token = row.private_key_pem[len(PREFIX):].encode("ascii")
        plaintext = f.decrypt(token).decode("utf-8")
        conn.execute(
            sa.text("UPDATE platform_ssh_key SET private_key_pem = :pem WHERE id = :id"),
            {"pem": plaintext, "id": row.id},
        )

    rows = conn.execute(
        sa.text("SELECT id, private_key_pem FROM user_ssh_keys WHERE private_key_pem IS NOT NULL")
    ).fetchall()
    for row in rows:
        if not row.private_key_pem.startswith(PREFIX):
            continue
        token = row.private_key_pem[len(PREFIX):].encode("ascii")
        plaintext = f.decrypt(token).decode("utf-8")
        conn.execute(
            sa.text("UPDATE user_ssh_keys SET private_key_pem = :pem WHERE id = :id"),
            {"pem": plaintext, "id": row.id},
        )

    op.drop_column("user_ssh_keys", "download_expires_at")
    op.drop_column("user_ssh_keys", "downloaded_at")
