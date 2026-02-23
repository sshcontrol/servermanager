"""Platform SSH key: generate, store, export as PEM and PPK."""

import base64
import io
from typing import Optional

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.backends import default_backend
import paramiko
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.platform_key import PlatformSSHKey


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
    # Fingerprint: MD5 or SHA256 of public key
    pkey = paramiko.RSAKey.from_private_key(io.StringIO(private_pem))
    fp = pkey.get_fingerprint()
    fingerprint = fp.hex() if isinstance(fp, bytes) else str(fp)
    return private_pem, public_openssh, fingerprint


def _mpint(x: int) -> bytes:
    """Encode integer as SSH mpint (RFC 4251): 4-byte big-endian length + value. Zero = 4 zero bytes. Positive values need leading zero byte if high bit would be set."""
    if x == 0:
        return b"\x00\x00\x00\x00"
    raw = x.to_bytes((x.bit_length() + 8) // 8, "big")
    if raw[0] & 0x80:
        raw = b"\x00" + raw
    return len(raw).to_bytes(4, "big") + raw


def _ssh_string(s: bytes) -> bytes:
    return len(s).to_bytes(4, "big") + s


def _pem_to_ppk(private_pem: str, comment: str = "sshcontrol") -> str:
    """Convert PEM (OpenSSH) private key to PuTTY PPK format v3 (RSA, no passphrase). PuTTY 0.75+ uses v3."""
    import hashlib
    import hmac
    from cryptography.hazmat.primitives.serialization import load_ssh_private_key

    key = load_ssh_private_key(private_pem.encode(), password=None, backend=default_backend())
    if not isinstance(key, rsa.RSAPrivateKey):
        raise ValueError("Only RSA keys supported for PPK export")
    private_numbers = key.private_numbers()
    public_numbers = key.public_key().public_numbers()
    n = public_numbers.n
    e = public_numbers.e
    d = private_numbers.d
    p = private_numbers.p
    q = private_numbers.q
    iqmp = private_numbers.iqmp

    # Public key blob: SSH wire format - string "ssh-rsa", mpint e, mpint n
    algo = b"ssh-rsa"
    pub_blob = _ssh_string(algo) + _mpint(e) + _mpint(n)
    # Private key blob for RSA (PuTTY C.3.1): d, p, q, iqmp
    priv_blob = _mpint(d) + _mpint(p) + _mpint(q) + _mpint(iqmp)

    pub_b64 = base64.b64encode(pub_blob).decode("ascii")
    priv_b64 = base64.b64encode(priv_blob).decode("ascii")

    # PuTTY expects base64 split at 64 chars per line (PEM/PPK convention). Wrong wrap breaks Private-MAC validation.
    def wrap(s: str, w: int = 64) -> list[str]:
        return [s[i : i + w] for i in range(0, len(s), w)]

    pub_lines = wrap(pub_b64)
    priv_lines = wrap(priv_b64)
    algo_name = "ssh-rsa"
    enc_type = "none"
    comment_bytes = comment.encode("utf-8")

    # PPK v3: HMAC-SHA-256, 64 hex digits. For encryption none, MAC key is zero length (PuTTY doc C.4).
    mac_data = (
        _ssh_string(algo_name.encode())
        + _ssh_string(enc_type.encode())
        + _ssh_string(comment_bytes)
        + _ssh_string(pub_blob)
        + _ssh_string(priv_blob)
    )
    mac = hmac.new(b"", mac_data, hashlib.sha256).hexdigest()  # noqa: S324

    # Match PuTTY output exactly: LF line endings, 64-char base64 lines (PPK convention), trailing newline
    lines = [
        "PuTTY-User-Key-File-3: ssh-rsa",
        "Encryption: none",
        f"Comment: {comment}",  # empty comment is "Comment: " (space after colon)
        f"Public-Lines: {len(pub_lines)}",
        *pub_lines,
        f"Private-Lines: {len(priv_lines)}",
        *priv_lines,
        f"Private-MAC: {mac}",
    ]
    return "\n".join(lines) + "\n"


class PlatformKeyService:
    @staticmethod
    async def get_key(db: AsyncSession, tenant_id: Optional[str] = None) -> Optional[PlatformSSHKey]:
        if tenant_id:
            result = await db.execute(select(PlatformSSHKey).where(PlatformSSHKey.tenant_id == tenant_id))
        else:
            result = await db.execute(select(PlatformSSHKey).where(PlatformSSHKey.tenant_id.is_(None)).limit(1))
        return result.scalar_one_or_none()

    @staticmethod
    async def get_public_info(db: AsyncSession, tenant_id: Optional[str] = None) -> dict:
        row = await PlatformKeyService.get_key(db, tenant_id)
        if not row:
            return {"has_key": False, "public_key": None, "fingerprint": None}
        return {
            "has_key": True,
            "public_key": row.public_key,
            "fingerprint": row.fingerprint,
        }

    @staticmethod
    async def regenerate(db: AsyncSession, tenant_id: Optional[str] = None) -> None:
        private_pem, public_openssh, fingerprint = _generate_rsa_key()
        row = await PlatformKeyService.get_key(db, tenant_id)
        if row:
            row.private_key_pem = private_pem
            row.public_key = public_openssh
            row.fingerprint = fingerprint
        else:
            row = PlatformSSHKey(
                tenant_id=tenant_id,
                private_key_pem=private_pem,
                public_key=public_openssh,
                fingerprint=fingerprint,
            )
            db.add(row)
        await db.flush()

    @staticmethod
    async def get_private_pem(db: AsyncSession, tenant_id: Optional[str] = None) -> Optional[str]:
        row = await PlatformKeyService.get_key(db, tenant_id)
        return row.private_key_pem if row else None

    @staticmethod
    async def get_ppk(db: AsyncSession, tenant_id: Optional[str] = None) -> Optional[str]:
        pem = await PlatformKeyService.get_private_pem(db, tenant_id)
        if not pem:
            return None
        return _pem_to_ppk(pem)
