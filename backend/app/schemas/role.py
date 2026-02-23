from pydantic import BaseModel, Field
from typing import List


class PermissionResponse(BaseModel):
    id: str
    name: str
    resource: str
    action: str
    description: str | None = None

    class Config:
        from_attributes = True


class RoleBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    description: str | None = None


class RoleCreate(RoleBase):
    permission_ids: List[str] = []


class RoleUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=80)
    description: str | None = None
    permission_ids: List[str] | None = None


class RoleResponse(BaseModel):
    id: str
    name: str
    description: str | None = None
    permissions: List[PermissionResponse] = []

    class Config:
        from_attributes = True
