"""Admin backup: full DB export (encrypted), import, and history CSV export."""

import asyncio
import csv
import io
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.auth import require_superuser, require_platform_superuser
from app.models import User
from app.services import backup_service, audit_service

router = APIRouter(prefix="/admin/backup", tags=["admin-backup"])


class ExportBackupBody(BaseModel):
    password: str


@router.post("/export")
async def export_backup(
    current_user: Annotated[User, Depends(require_platform_superuser)],
    body: ExportBackupBody,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Download a full database backup as an encrypted file. Provide password in JSON body; use the same password to import elsewhere."""
    password = body.password
    if not password or len(str(password)) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    try:
        await audit_service.log(
            db, "backup_exported",
            resource_type="backup",
            user_id=str(current_user.id),
            username=current_user.username,
            details="Full database backup exported",
        )
    except Exception:
        pass
    try:
        data = await asyncio.to_thread(backup_service.export_backup, str(password))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    filename = f"servermanager-backup-{datetime.now(timezone.utc).strftime('%Y-%m-%d-%H%M')}.encrypted"
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import")
async def import_backup(
    current_user: Annotated[User, Depends(require_platform_superuser)],
    db: Annotated[AsyncSession, Depends(get_db)],
    file: Annotated[UploadFile, File(description="Encrypted backup file")],
    password: Annotated[str, Form(description="Password used when creating the backup")],
    confirm: Annotated[str, Form(description="Type 'restore' to confirm")],
):
    """Restore the full database from an encrypted backup. Replaces all current data. Requires confirm='restore'."""
    if confirm != "restore":
        raise HTTPException(
            status_code=400,
            detail="Type 'restore' in the confirmation field to restore the database.",
        )
    if not password or len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    try:
        data = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read file: {e}") from e
    if not data:
        raise HTTPException(status_code=400, detail="File is empty")
    if len(data) > 100 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Backup file too large (max 100 MB)")
    try:
        await audit_service.log(
            db, "backup_imported",
            resource_type="backup",
            user_id=str(current_user.id),
            username=current_user.username,
            details=f"Database restore initiated, file size={len(data)} bytes",
        )
    except Exception:
        pass
    await db.flush()
    try:
        await asyncio.to_thread(backup_service.import_backup, data, password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Restore failed: {str(e)}",
        ) from e
    return {"message": "Database restored from backup."}


@router.get("/history-csv")
async def export_history_csv(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    """Export full audit history as a human-readable CSV file for reporting."""
    entries = await audit_service.get_all_logs_for_export(db)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["id", "created_at", "action", "resource_type", "resource_id", "user_id", "username", "ip_address", "details"])
    for e in entries:
        writer.writerow([
            e.id,
            e.created_at.isoformat() if e.created_at else "",
            e.action or "",
            e.resource_type or "",
            e.resource_id or "",
            e.user_id or "",
            e.username or "",
            e.ip_address or "",
            e.details or "",
        ])
    csv_content = buf.getvalue().encode("utf-8-sig")  # BOM for Excel
    filename = f"servermanager-history-{datetime.now(timezone.utc).strftime('%Y-%m-%d-%H%M')}.csv"
    return Response(
        content=csv_content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
