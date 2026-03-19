from sqlalchemy import Column, String, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.utils import generate_uuid, utcnow_naive


class UserSSHKey(Base):
    """SSH key pair for a user. Used to connect to assigned servers with assigned role (root/user on server)."""

    __tablename__ = "user_ssh_keys"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(100), nullable=False)  # e.g. "default", "laptop"
    public_key = Column(Text, nullable=False)  # OpenSSH public key string
    private_key_pem = Column(Text, nullable=True)  # Encrypted PEM; nullable for keys uploaded as public-only
    fingerprint = Column(String(64), nullable=False, index=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)
    downloaded_at = Column(DateTime, nullable=True)  # First download timestamp; key deleted 48h after creation
    download_expires_at = Column(DateTime, nullable=True)  # After this time, private key is purged

    user = relationship("User", back_populates="ssh_keys")
