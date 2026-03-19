"""Per-user SSH keys for server access. Role (root/user) is per-server and enforced via authorized_keys."""

import base64
import hashlib
import io
from datetime import timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.backends import default_backend
import paramiko

from app.models.ssh_key import UserSSHKey
from app.models.user import User
from app.models.utils import utcnow_naive
from app.core.encryption import encrypt_private_key, decrypt_private_key

USER_KEY_DOWNLOAD_FILENAME_PEM = "sshcontrol-key.pem"
USER_KEY_DOWNLOAD_FILENAME_PPK = "sshcontrol-key.ppk"

KEY_DOWNLOAD_WINDOW_HOURS = 48

ALLOWED_PUBLIC_KEY_TYPES = ("ssh-rsa", "ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521")


def _parse_public_key(line: str) -> tuple[str, str]:
    """Validate a single OpenSSH public key line and return (normalized_line, fingerprint_hex). Raises ValueError if invalid."""
    line = line.strip()
    if not line or line.startswith("#"):
        raise ValueError("Empty or comment line.")
    parts = line.split(None, 2)
    if len(parts) < 2:
        raise ValueError("Invalid public key format: expected 'type keydata [comment]'.")
    key_type, key_b64 = parts[0], parts[1]
    if key_type not in ALLOWED_PUBLIC_KEY_TYPES:
        raise ValueError(f"Unsupported key type: {key_type}. Use ssh-rsa, ssh-ed25519, or ecdsa-sha2-nistp*.")
    try:
        blob = base64.b64decode(key_b64, validate=True)
    except Exception as e:
        raise ValueError("Invalid base64 in public key.") from e
    if len(blob) < 32:
        raise ValueError("Public key data too short.")
    fingerprint = hashlib.md5(blob).hexdigest()
    normalized = f"{key_type} {key_b64}" + (f" {parts[2]}" if len(parts) > 2 else "")
    return normalized, fingerprint


def _generate_rsa_key() -> tuple[str, str, str]:
    """Generate RSA 4096 key; return (private_pem, public_openssh, fingerprint)."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=4096, backend=default_backend())
    private_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.OpenSSH,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")
    public_openssh = key.public_key().public_bytes(
        encoding=serialization.Encoding.OpenSSH,
        format=serialization.PublicFormat.OpenSSH,
    ).decode("utf-8")
    pkey = paramiko.RSAKey.from_private_key(io.StringIO(private_pem))
    fp = pkey.get_fingerprint()
    fingerprint = fp.hex() if isinstance(fp, bytes) else str(fp)
    return private_pem, public_openssh, fingerprint


async def ensure_user_has_ssh_key(db: AsyncSession, user_id: str) -> UserSSHKey | None:
    """If user has no SSH key, generate one and store it. Return the user's first key."""
    r = await db.execute(
        select(UserSSHKey).where(UserSSHKey.user_id == user_id).order_by(UserSSHKey.created_at).limit(1)
    )
    existing = r.scalar_one_or_none()
    if existing:
        return existing
    private_pem, public_openssh, fingerprint = _generate_rsa_key()
    now = utcnow_naive()
    key = UserSSHKey(
        user_id=user_id,
        name="default",
        public_key=public_openssh,
        private_key_pem=encrypt_private_key(private_pem),
        fingerprint=fingerprint,
        download_expires_at=now + timedelta(hours=KEY_DOWNLOAD_WINDOW_HOURS),
    )
    db.add(key)
    await db.flush()
    return key


async def regenerate_user_ssh_key(db: AsyncSession, user_id: str) -> UserSSHKey:
    """Delete all existing SSH keys for the user and create a new one. Servers get the new key on next sync (within 5 min)."""
    await db.execute(delete(UserSSHKey).where(UserSSHKey.user_id == user_id))
    await db.flush()
    key = await ensure_user_has_ssh_key(db, user_id)
    return key


async def get_decrypted_private_key(db: AsyncSession, user_id: str) -> tuple[UserSSHKey | None, str | None]:
    """Return (key_row, decrypted_pem) for a user. Returns (None, None) if no key or expired."""
    r = await db.execute(
        select(UserSSHKey)
        .where(UserSSHKey.user_id == user_id)
        .where(UserSSHKey.private_key_pem.isnot(None))
        .order_by(UserSSHKey.created_at)
        .limit(1)
    )
    key = r.scalar_one_or_none()
    if not key or not key.private_key_pem:
        return None, None
    if key.download_expires_at and utcnow_naive() > key.download_expires_at:
        key.private_key_pem = None
        await db.flush()
        return key, None
    return key, decrypt_private_key(key.private_key_pem)


async def mark_downloaded(db: AsyncSession, key: UserSSHKey) -> None:
    """Record first download timestamp."""
    if key.downloaded_at is None:
        key.downloaded_at = utcnow_naive()
        await db.flush()


async def purge_expired_private_keys(db: AsyncSession) -> int:
    """Null out private keys past their download window. Returns count of purged keys."""
    now = utcnow_naive()
    r = await db.execute(
        select(UserSSHKey)
        .where(UserSSHKey.private_key_pem.isnot(None))
        .where(UserSSHKey.download_expires_at.isnot(None))
        .where(UserSSHKey.download_expires_at < now)
    )
    keys = r.scalars().all()
    for k in keys:
        k.private_key_pem = None
    if keys:
        await db.flush()
    return len(keys)


async def set_user_public_key(db: AsyncSession, user_id: str, public_key_str: str) -> UserSSHKey:
    """Set the user's SSH key to the given public key only (no private key stored). Validates format and computes fingerprint. Replaces any existing key; synced to assigned servers on next sync."""
    line = public_key_str.strip().split("\n")[0] if public_key_str else ""
    normalized, fingerprint = _parse_public_key(line)
    await db.execute(delete(UserSSHKey).where(UserSSHKey.user_id == user_id))
    await db.flush()
    key = UserSSHKey(
        user_id=user_id,
        name="default",
        public_key=normalized,
        private_key_pem=None,
        fingerprint=fingerprint,
    )
    db.add(key)
    await db.flush()
    return key
