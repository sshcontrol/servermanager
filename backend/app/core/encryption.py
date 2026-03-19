"""Fernet (AES-128-CBC + HMAC-SHA256) encryption for SSH private keys at rest.

The ENCRYPTION_KEY env var must be a valid Fernet key (base64-encoded 32 bytes).
Generate one with:  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""

import os
from functools import lru_cache
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

_PREFIX = "enc:v1:"


@lru_cache(maxsize=1)
def _get_fernet() -> Optional[Fernet]:
    key = os.environ.get("ENCRYPTION_KEY", "").strip()
    if not key:
        return None
    return Fernet(key.encode())


def encrypt_private_key(plaintext: Optional[str]) -> Optional[str]:
    """Encrypt a PEM private key string. Returns prefixed ciphertext or None."""
    if plaintext is None:
        return None
    f = _get_fernet()
    if f is None:
        return plaintext
    token = f.encrypt(plaintext.encode("utf-8"))
    return _PREFIX + token.decode("ascii")


def decrypt_private_key(stored: Optional[str]) -> Optional[str]:
    """Decrypt a stored private key. Handles both encrypted (prefixed) and legacy plaintext."""
    if stored is None:
        return None
    if not stored.startswith(_PREFIX):
        return stored
    f = _get_fernet()
    if f is None:
        raise RuntimeError("ENCRYPTION_KEY env var is required to decrypt SSH keys")
    try:
        token = stored[len(_PREFIX):].encode("ascii")
        return f.decrypt(token).decode("utf-8")
    except InvalidToken:
        raise RuntimeError("Failed to decrypt SSH key — ENCRYPTION_KEY may be wrong")


def is_encrypted(stored: Optional[str]) -> bool:
    """Check whether a stored value is already encrypted."""
    if stored is None:
        return False
    return stored.startswith(_PREFIX)
