"""Tenant settings for tenant owner (company name, etc.)."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import User
from app.models.tenant import Tenant
from app.core.auth import get_current_user

router = APIRouter()


class TenantSettingsUpdate(BaseModel):
    company_name: str | None = Field(None, min_length=0, max_length=255)


def _is_tenant_owner(user: User, tenant_id: str | None) -> bool:
    if not tenant_id or not user.tenant_id or user.tenant_id != tenant_id:
        return False
    # Check if user is owner - we need to load the tenant
    return True  # Will verify in endpoint


@router.patch("/me")
async def update_my_tenant(
    data: TenantSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update current user's tenant settings (company name). Tenant owner only."""
    if not current_user.tenant_id:
        raise HTTPException(status_code=403, detail="You are not part of a tenant.")
    tenant_id = current_user.tenant_id

    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if str(tenant.owner_id) != str(current_user.id):
        raise HTTPException(status_code=403, detail="Only the tenant owner can update company name.")

    if data.company_name is not None:
        tenant.company_name = data.company_name.strip()
    await db.flush()
    return {"company_name": tenant.company_name}
