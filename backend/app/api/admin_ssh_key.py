from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.platform_key_service import PlatformKeyService
from app.core.auth import require_superuser
from app.models import User

router = APIRouter(prefix="/admin/ssh-key", tags=["admin-ssh-key"])


@router.get("")
async def get_ssh_key_info(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    info = await PlatformKeyService.get_public_info(db, tenant_id=current_user.tenant_id)
    return info


@router.post("/regenerate")
async def regenerate_ssh_key(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    await PlatformKeyService.regenerate(db, tenant_id=current_user.tenant_id)
    return {"message": "SSH key regenerated"}


@router.get("/download")
async def download_ssh_key(
    format: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    if format in ("pem", "pk"):
        content = await PlatformKeyService.get_private_pem(db, tenant_id=current_user.tenant_id)
        if not content:
            raise HTTPException(status_code=404, detail="No SSH key. Regenerate first.")
        return PlainTextResponse(content, media_type="application/x-pem-file", headers={
            "Content-Disposition": "attachment; filename=sshcontrol_key.pem"
        })
    if format == "ppk":
        content = await PlatformKeyService.get_ppk(db, tenant_id=current_user.tenant_id)
        if not content:
            raise HTTPException(status_code=404, detail="No SSH key. Regenerate first.")
        return PlainTextResponse(content, media_type="application/x-ppk", headers={
            "Content-Disposition": "attachment; filename=sshcontrol_key.ppk"
        })
    raise HTTPException(status_code=400, detail="format must be pem or ppk")
