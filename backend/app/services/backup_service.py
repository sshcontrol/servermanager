"""Full database backup: export as encrypted file, import to restore. Not human-readable."""

import base64
import gzip
import json
import os
from datetime import datetime, date, timezone
from decimal import Decimal
from uuid import UUID

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from sqlalchemy import text

from app.database import engine, Base

BACKUP_VERSION = 1
PBKDF2_ITERATIONS = 120_000
# Salt length in bytes; a fresh random salt is generated per backup
SALT_LENGTH = 16


def clean_database() -> None:
    """Truncate all application tables. Use for a full cleanup. Does not drop the database or schema."""
    tables_ordered = Base.metadata.sorted_tables
    table_names = [t.name for t in tables_ordered]
    if not table_names:
        return
    quoted = ", ".join(f'"{n}"' for n in table_names)
    with engine.begin() as conn:
        conn.execute(text("SET session_replication_role = replica"))
        conn.execute(text(f"TRUNCATE TABLE {quoted} RESTART IDENTITY CASCADE"))
        conn.execute(text("SET session_replication_role = default"))


def _derive_key(password: str, salt: bytes) -> bytes:
    if not password or len(password) < 8:
        raise ValueError("Password must be at least 8 characters")
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
    )
    key = kdf.derive(password.encode("utf-8"))
    return base64.urlsafe_b64encode(key)


def _serialize_value(v):
    if v is None:
        return None
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, (UUID, Decimal)):
        return str(v)
    if isinstance(v, bytes):
        return v.hex()
    if isinstance(v, (str, int, float, bool)):
        return v
    return str(v)


def _row_to_dict(row):
    return {k: _serialize_value(v) for k, v in row._mapping.items()}


def export_backup(password: str) -> bytes:
    """Export full database to encrypted bytes. A random salt is generated and prepended to the output."""
    salt = os.urandom(SALT_LENGTH)
    key = _derive_key(password, salt)
    fernet = Fernet(key)

    tables_data = {}
    with engine.connect() as conn:
        for table in Base.metadata.sorted_tables:
            name = table.name
            r = conn.execute(table.select())
            rows = [_row_to_dict(row) for row in r]
            tables_data[name] = rows

    payload = {
        "version": BACKUP_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "tables": tables_data,
    }
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    compressed = gzip.compress(raw, compresslevel=6)
    encrypted = fernet.encrypt(compressed)
    # Prepend salt so the importer can derive the same key
    return salt + encrypted


def import_backup(encrypted_data: bytes, password: str) -> None:
    """Decrypt and restore full database from backup. Replaces all data. Use with caution."""
    if len(encrypted_data) < SALT_LENGTH + 1:
        raise ValueError("Backup file is too small or corrupted")
    # Extract salt from the first SALT_LENGTH bytes
    salt = encrypted_data[:SALT_LENGTH]
    ciphertext = encrypted_data[SALT_LENGTH:]
    key = _derive_key(password, salt)
    fernet = Fernet(key)
    try:
        compressed = fernet.decrypt(ciphertext)
    except Exception as e:
        raise ValueError("Decryption failed: wrong password or corrupted file") from e
    raw = gzip.decompress(compressed)
    payload = json.loads(raw.decode("utf-8"))
    if payload.get("version") != BACKUP_VERSION:
        raise ValueError(f"Unsupported backup version: {payload.get('version')}")

    tables_data = payload.get("tables") or {}
    tables_ordered = Base.metadata.sorted_tables
    table_names = [t.name for t in tables_ordered]

    with engine.begin() as conn:
        conn.execute(text("SET session_replication_role = replica"))
        quoted = ", ".join(f'"{n}"' for n in table_names)
        conn.execute(text(f"TRUNCATE TABLE {quoted} RESTART IDENTITY CASCADE"))
        for table in tables_ordered:
            name = table.name
            rows = tables_data.get(name, [])
            if not rows:
                continue
            for row in rows:
                cols = [c.name for c in table.c if c.name in row]
                if not cols:
                    continue
                ins = table.insert().values(**{k: row[k] for k in cols})
                conn.execute(ins)
        conn.execute(text("SET session_replication_role = default"))
