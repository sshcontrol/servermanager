from sqlalchemy import Column, String, Text
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.utils import generate_uuid


class Role(Base):
    __tablename__ = "roles"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    name = Column(String(80), unique=True, nullable=False, index=True)
    description = Column(Text, nullable=True)

    users = relationship("User", secondary="user_roles", back_populates="roles")
    permissions = relationship("Permission", secondary="role_permissions", back_populates="roles")


class Permission(Base):
    __tablename__ = "permissions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    name = Column(String(80), unique=True, nullable=False, index=True)  # e.g. "servers:read"
    resource = Column(String(80), nullable=False, index=True)  # e.g. "servers"
    action = Column(String(80), nullable=False, index=True)  # e.g. "read", "write", "delete"
    description = Column(Text, nullable=True)

    roles = relationship("Role", secondary="role_permissions", back_populates="permissions")
