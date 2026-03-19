import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.schemas.user import UserCreate, UserUpdate, ProfileUpdate, PublicKeyUpload, UserResponse, UserListResponse, RoleBrief, ServerAccessItem
from app.schemas.auth import RequestPhoneVerificationRequest, VerifyPhoneRequest
from app.services.user_service import UserService
from app.services import audit_service, server_service, user_key_service, sync_service
from app.services.platform_key_service import PlatformKeyService
from app.config import get_settings
from app.core.auth import get_current_user, RequireUsersRead, RequireUsersWrite, require_superuser
from app.models import User
from app.models.ssh_key import UserSSHKey
from app.models.tenant import UserInvitation

router = APIRouter()
logger = logging.getLogger(__name__)


def _user_to_response(
    u: User, effective_access: list[dict] | None = None
) -> UserResponse:
    resp = UserResponse(
        id=u.id,
        email=u.email,
        username=u.username,
        phone=getattr(u, "phone", None) or None,
        is_active=u.is_active,
        is_superuser=u.is_superuser,
        totp_enabled=u.totp_enabled,
        phone_verified=getattr(u, "phone_verified", False),
        sms_verification_enabled=getattr(u, "sms_verification_enabled", False),
        onboarding_completed=getattr(u, "onboarding_completed", True),
        needs_initial_password=getattr(u, "needs_initial_password", False),
        created_at=u.created_at,
        roles=[RoleBrief(id=r.id, name=r.name) for r in u.roles],
        server_access=[
            ServerAccessItem(server_id=a.server_id, role=a.role)
            for a in (getattr(u, "server_accesses", None) or [])
        ],
    )
    if effective_access is not None:
        resp.effective_server_access = [
            ServerAccessItem(server_id=a["server_id"], role=a["role"]) for a in effective_access
        ]
    return resp


@router.get("/stats")
async def get_user_stats(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(RequireUsersRead)],
):
    """Return { total, active, inactive } for dashboard (admin). Excludes admin from counts."""
    return await UserService.get_stats(db, tenant_id=current_user.tenant_id, exclude_admins=True)


@router.get("", response_model=UserListResponse)
async def list_users(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(RequireUsersRead)],
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    exclude_admins: bool = Query(False, description="Exclude is_superuser and admin role from list (e.g. for Modify Users)"),
):
    users, total = await UserService.list_users(db, skip=skip, limit=limit, tenant_id=current_user.tenant_id, exclude_admins=exclude_admins)
    tenant_id = current_user.tenant_id
    result = []
    for u in users:
        eff = await server_service.get_user_effective_server_access(db, str(u.id), tenant_id=tenant_id)
        result.append(_user_to_response(u, effective_access=eff))
    return UserListResponse(users=result, total=total)


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: Annotated[User, Depends(get_current_user)]):
    return _user_to_response(current_user)


@router.get("/me/groups")
async def get_my_groups(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Return current user's user groups, server groups, and servers with access source (direct / server_group / user_group)."""
    return await server_service.get_my_groups_and_servers(db, str(current_user.id), current_user.is_superuser, tenant_id=current_user.tenant_id)


@router.get("/online")
async def get_online_users(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_superuser)],
):
    """Admin only: list users with active panel session (last seen in last 5 min) and the servers they have access to."""
    users = await UserService.get_online_users(db, within_minutes=5, tenant_id=current_user.tenant_id)
    return {"count": len(users), "users": users}


@router.patch("/me", response_model=UserResponse)
async def update_me(
    data: ProfileUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Update current user's username and email. Phone must be set via Profile → Security (request-phone-verification + verify-phone)."""
    update_data = UserUpdate(username=data.username, email=data.email, phone=None)
    user = await UserService.update_user(db, str(current_user.id), update_data)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return _user_to_response(user)


@router.get("/me/ssh-key")
async def get_my_ssh_key(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Get current user's SSH key info (for connecting to assigned servers). Role on each server is admin or user (on that server)."""
    r = await db.execute(
        select(UserSSHKey)
        .where(UserSSHKey.user_id == current_user.id)
        .order_by(UserSSHKey.created_at)
        .limit(1)
    )
    key = r.scalar_one_or_none()
    if not key:
        return {"has_key": False, "public_key": None, "fingerprint": None, "uses_own_key": False, "download_available": False, "download_expires_at": None, "downloaded_at": None}
    from app.models.utils import utcnow_naive
    download_available = (
        key.private_key_pem is not None
        and (key.download_expires_at is None or utcnow_naive() <= key.download_expires_at)
    )
    return {
        "has_key": True,
        "public_key": key.public_key,
        "fingerprint": key.fingerprint,
        "uses_own_key": key.private_key_pem is None,
        "download_available": download_available,
        "download_expires_at": key.download_expires_at.isoformat() if key.download_expires_at else None,
        "downloaded_at": key.downloaded_at.isoformat() if key.downloaded_at else None,
    }


def _sync_result_item(server_id: str, server_name: str, result: dict) -> dict:
    return {
        "server_id": server_id,
        "server_name": server_name,
        "success": result.get("success", False),
        "error": result.get("error"),
        "output": result.get("output"),
    }


@router.post("/me/ssh-key/public")
async def set_my_ssh_public_key(
    data: PublicKeyUpload,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Set your SSH key to an uploaded public key. Synced immediately to all assigned servers."""
    try:
        await user_key_service.set_user_public_key(db, str(current_user.id), data.public_key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    servers = await server_service.list_servers(db, str(current_user.id), current_user.is_superuser)
    for srv in servers:
        await server_service.set_sync_requested(db, srv.id)
    sync_results = []
    settings = get_settings()
    if settings.enable_ssh_sync:
        private_key = await PlatformKeyService.get_private_pem(db)
        if private_key:
            for srv in servers:
                result = await sync_service.run_sync_on_server(srv, private_key)
                if result["success"]:
                    await server_service.clear_sync_requested(db, srv.id)
                sync_results.append(_sync_result_item(srv.id, getattr(srv, "friendly_name", None) or srv.hostname, result))
    if not sync_results:
        for srv in servers:
            sync_results.append(_sync_result_item(srv.id, getattr(srv, "friendly_name", None) or srv.hostname, {"success": True, "output": "Sync requested. Target will apply within ~1 min (cron)."}))
    return {
        "message": "Your SSH public key has been saved. Synced to assigned servers.",
        "sync_results": sync_results,
    }


@router.post("/me/ssh-key/regenerate")
async def regenerate_my_ssh_key(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Regenerate current user's SSH key. Synced immediately to all assigned servers."""
    await user_key_service.regenerate_user_ssh_key(db, str(current_user.id))
    servers = await server_service.list_servers(db, str(current_user.id), current_user.is_superuser)
    for srv in servers:
        await server_service.set_sync_requested(db, srv.id)
    sync_results = []
    settings = get_settings()
    if settings.enable_ssh_sync:
        private_key = await PlatformKeyService.get_private_pem(db)
        if private_key:
            for srv in servers:
                result = await sync_service.run_sync_on_server(srv, private_key)
                if result["success"]:
                    await server_service.clear_sync_requested(db, srv.id)
                sync_results.append(_sync_result_item(srv.id, getattr(srv, "friendly_name", None) or srv.hostname, result))
    if not sync_results:
        for srv in servers:
            sync_results.append(_sync_result_item(srv.id, getattr(srv, "friendly_name", None) or srv.hostname, {"success": True, "output": "Sync requested. Target will apply within ~1 min (cron)."}))
    return {
        "message": "SSH key regenerated. Re-download your PEM or PPK.",
        "sync_results": sync_results,
    }


@router.get("/me/ssh-key/download")
async def download_my_ssh_key(
    format: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Download current user's SSH private key (PEM or PPK). Available for 48 hours after generation."""
    key, private_pem = await user_key_service.get_decrypted_private_key(db, str(current_user.id))
    if not key or not private_pem:
        raise HTTPException(
            status_code=404,
            detail="No downloadable private key. The download window (48 hours) may have expired. Regenerate a new key to get a fresh download window.",
        )
    await user_key_service.mark_downloaded(db, key)
    if format in ("pem", "pk"):
        return PlainTextResponse(
            private_pem,
            media_type="application/x-pem-file",
            headers={"Content-Disposition": f'attachment; filename="{user_key_service.USER_KEY_DOWNLOAD_FILENAME_PEM}"'},
        )
    if format == "ppk":
        from app.services.platform_key_service import _pem_to_ppk
        content = _pem_to_ppk(private_pem, comment=current_user.username)
        return PlainTextResponse(
            content,
            media_type="application/x-ppk",
            headers={"Content-Disposition": f'attachment; filename="{user_key_service.USER_KEY_DOWNLOAD_FILENAME_PPK}"'},
        )
    raise HTTPException(status_code=400, detail="format must be pem or ppk")


# Invitations routes must be before /{user_id} so /invitations is not matched as user_id
@router.get("/invitations")
async def list_invitations(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(RequireUsersRead)],
):
    """List pending invitations for the current tenant."""
    if not current_user.tenant_id:
        return {"invitations": []}

    result = await db.execute(
        select(UserInvitation)
        .where(UserInvitation.tenant_id == current_user.tenant_id)
        .order_by(UserInvitation.created_at.desc())
    )
    invitations = result.scalars().all()
    items = []
    for inv in invitations:
        inviter_name = None
        if inv.invited_by:
            inv_r = await db.execute(select(User).where(User.id == inv.invited_by))
            inviter = inv_r.scalar_one_or_none()
            inviter_name = (inviter.full_name or inviter.username) if inviter else None
        items.append({
            "id": inv.id,
            "email": inv.email,
            "role_name": inv.role_name,
            "accepted": inv.accepted,
            "expires_at": inv.expires_at.isoformat() if inv.expires_at else "",
            "created_at": inv.created_at.isoformat() if inv.created_at else "",
            "invited_by_name": inviter_name,
        })
    return {"invitations": items}


@router.delete("/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_invitation(
    invitation_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(RequireUsersWrite)],
):
    """Cancel a pending invitation."""
    result = await db.execute(
        select(UserInvitation).where(
            UserInvitation.id == invitation_id,
            UserInvitation.tenant_id == current_user.tenant_id,
        )
    )
    inv = result.scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")
    await db.delete(inv)
    await db.flush()
    return None


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(RequireUsersRead)],
):
    user = await UserService.get_user(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    eff = await server_service.get_user_effective_server_access(db, user_id, tenant_id=current_user.tenant_id)
    return _user_to_response(user, effective_access=eff)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_user(
    data: UserCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(RequireUsersWrite)],
):
    if current_user.tenant_id:
        from app.services.tenant_service import TenantService
        await TenantService.check_user_limit(db, current_user.tenant_id)
    user = await UserService.create_user(db, data, tenant_id=current_user.tenant_id)
    await audit_service.log(
        db, "user_created",
        resource_type="user", resource_id=user.id,
        user_id=str(current_user.id), username=current_user.username,
        details=f"username={user.username}",
    )
    sync_results = []
    settings = get_settings()
    if data.server_access:
        if settings.enable_ssh_sync:
            private_key = await PlatformKeyService.get_private_pem(db)
            if private_key:
                for a in data.server_access:
                    server = await server_service.get_server(db, a.server_id)
                    if server:
                        result = await sync_service.run_sync_on_server(server, private_key)
                        if result["success"]:
                            await server_service.clear_sync_requested(db, a.server_id)
                        sync_results.append(_sync_result_item(
                            a.server_id,
                            getattr(server, "friendly_name", None) or server.hostname,
                            result,
                        ))
        if not sync_results:
            for a in data.server_access:
                server = await server_service.get_server(db, a.server_id)
                name = getattr(server, "friendly_name", None) or getattr(server, "hostname", "") if server else a.server_id
                sync_results.append(_sync_result_item(a.server_id, name, {"success": True, "output": "Sync requested. Target will apply within ~1 min (cron)."}))
    resp = _user_to_response(user)
    return {**resp.model_dump(), "sync_results": sync_results}


@router.post("/{user_id}/request-phone-verification")
async def admin_request_phone_verification(
    user_id: str,
    data: RequestPhoneVerificationRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(RequireUsersWrite)],
):
    """Admin: send SMS verification code to a phone number for the target user. Use verify-phone to complete."""
    from app.models.tenant import PhoneVerificationToken
    from app.models.user import utcnow_naive
    from datetime import timedelta
    from sqlalchemy import delete
    import secrets
    from app.services import sms_service

    target = await UserService.get_user(db, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if target.tenant_id != current_user.tenant_id and not (current_user.is_superuser and not current_user.tenant_id):
        raise HTTPException(status_code=403, detail="Access denied")

    code = "".join(secrets.choice("0123456789") for _ in range(4))
    now = utcnow_naive()
    expires_at = now + timedelta(minutes=10)
    await db.execute(delete(PhoneVerificationToken).where(PhoneVerificationToken.user_id == user_id))
    await db.flush()
    token = PhoneVerificationToken(user_id=user_id, phone=data.phone, code=code, expires_at=expires_at)
    db.add(token)
    await db.flush()
    sent, _ = await sms_service.send_sms(db, data.phone, f"Your SSHCONTROL verification code is: {code}")
    if not sent:
        raise HTTPException(status_code=503, detail="Could not send SMS. Check SMS configuration.")
    return {"message": "Verification code sent."}


@router.post("/{user_id}/verify-phone")
async def admin_verify_phone(
    user_id: str,
    data: VerifyPhoneRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(RequireUsersWrite)],
):
    """Admin: verify phone with code and set user's phone (verified)."""
    from app.models.tenant import PhoneVerificationToken
    from app.models.user import utcnow_naive
    from sqlalchemy import select, delete

    target = await UserService.get_user(db, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if target.tenant_id != current_user.tenant_id and not (current_user.is_superuser and not current_user.tenant_id):
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(
        select(PhoneVerificationToken).where(
            PhoneVerificationToken.user_id == user_id,
            PhoneVerificationToken.phone == data.phone,
        ).order_by(PhoneVerificationToken.created_at.desc()).limit(1)
    )
    token_row = result.scalar_one_or_none()
    if not token_row:
        raise HTTPException(status_code=400, detail="No verification code found. Request a new one.")
    if utcnow_naive() > token_row.expires_at:
        await db.execute(delete(PhoneVerificationToken).where(PhoneVerificationToken.id == token_row.id))
        await db.flush()
        raise HTTPException(status_code=400, detail="Verification code expired. Request a new one.")
    if token_row.code != data.code.strip():
        raise HTTPException(status_code=400, detail="Invalid verification code.")

    target.phone = data.phone
    target.phone_verified = True
    await db.execute(delete(PhoneVerificationToken).where(PhoneVerificationToken.id == token_row.id))
    await db.flush()
    return {"message": "Phone verified."}


@router.patch("/{user_id}")
async def update_user(
    user_id: str,
    data: UserUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(RequireUsersWrite)],
):
    target = await UserService.get_user(db, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if data.phone is not None and getattr(target, "phone_verified", False):
        is_platform_superadmin = current_user.is_superuser and current_user.tenant_id is None
        if not is_platform_superadmin:
            raise HTTPException(status_code=403, detail="Phone is verified and can only be changed by platform administrator.")
    user = await UserService.update_user(db, user_id, data)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    sync_results = []
    settings = get_settings()
    if data.server_access is not None:
        if settings.enable_ssh_sync:
            private_key = await PlatformKeyService.get_private_pem(db)
            if private_key:
                for a in data.server_access:
                    server = await server_service.get_server(db, a.server_id)
                    if server:
                        result = await sync_service.run_sync_on_server(server, private_key)
                        if result["success"]:
                            await server_service.clear_sync_requested(db, a.server_id)
                        sync_results.append(_sync_result_item(
                            a.server_id,
                            getattr(server, "friendly_name", None) or server.hostname,
                            result,
                        ))
        if not sync_results and data.server_access:
            for a in data.server_access:
                server = await server_service.get_server(db, a.server_id)
                name = getattr(server, "friendly_name", None) or getattr(server, "hostname", "") if server else a.server_id
                sync_results.append(_sync_result_item(a.server_id, name, {"success": True, "output": "Sync requested. Target will apply within ~1 min (cron)."}))
    resp = _user_to_response(user)
    if isinstance(resp, dict):
        resp["sync_results"] = sync_results
    else:
        resp = {**resp.model_dump(), "sync_results": sync_results}
    return resp


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(RequireUsersWrite)],
):
    from app.core.auth import verify_destructive_verification_token
    verify_destructive_verification_token(request, current_user, "delete_user", user_id)
    deleted_user = await UserService.get_user(db, user_id)
    if not deleted_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    deleted_username = deleted_user.username
    ok = await UserService.delete_user(db, user_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await audit_service.log(
        db, "user_deleted",
        resource_type="user", resource_id=user_id,
        user_id=str(current_user.id), username=current_user.username,
        details=f"username={deleted_username}",
    )


@router.post("/{user_id}/resend-welcome")
async def resend_welcome(
    user_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(RequireUsersWrite)],
):
    """Send a password reset email to a user who accepted an invitation but never completed the welcome flow.
    Only works for users with needs_initial_password=True in the same tenant."""
    target = await UserService.get_user(db, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="User not found")
    if not getattr(target, "needs_initial_password", False):
        raise HTTPException(
            status_code=400,
            detail="User has already completed setup. Use Forgot password on the login page instead.",
        )
    from app.services.email_service import send_password_reset_email
    try:
        await send_password_reset_email(
            db, str(target.id), target.email,
            target.full_name or target.username,
        )
    except Exception as e:
        logger.warning("Resend welcome email failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to send email. Check email configuration.")
    await audit_service.log(
        db, "resend_welcome",
        resource_type="user", resource_id=user_id,
        user_id=str(current_user.id), username=current_user.username,
        details=f"email={target.email}",
    )
    return {"message": f"Password reset link sent to {target.email}."}


# ─── Invitations ──────────────────────────────────────────────────────────────

from pydantic import BaseModel as _BM, EmailStr as _ES, Field as _F
from app.models.tenant import UserInvitation, Tenant
from app.models.user import generate_uuid, utcnow_naive
from datetime import timedelta
import secrets


class InviteUserRequest(_BM):
    email: _ES
    role_name: str = _F(default="user", max_length=50)


INVITE_TOKEN_HOURS = 72


@router.post("/invite", status_code=status.HTTP_201_CREATED)
async def invite_user(
    data: InviteUserRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(RequireUsersWrite)],
):
    """Send an invitation email for a new user to join the tenant."""
    if not current_user.tenant_id:
        raise HTTPException(status_code=403, detail="Platform superadmin cannot invite users to a tenant")

    from app.services.tenant_service import TenantService
    await TenantService.check_user_limit(db, current_user.tenant_id, include_pending_invitations=True)

    existing_user_r = await db.execute(select(User).where(User.email == data.email))
    existing_user = existing_user_r.scalar_one_or_none()
    if existing_user:
        # User exists: allow re-invite only if they never completed onboarding (same tenant)
        if (
            existing_user.tenant_id == current_user.tenant_id
            and not getattr(existing_user, "onboarding_completed", True)
            and getattr(existing_user, "needs_initial_password", False)
        ):
            # Send password reset so they can set a password and complete welcome
            from app.services.email_service import send_password_reset_email
            try:
                await send_password_reset_email(
                    db, str(existing_user.id), existing_user.email,
                    existing_user.full_name or existing_user.username,
                )
            except Exception as e:
                logger.warning("Resend welcome email failed: %s", e)
            return {"message": f"Password reset link sent to {data.email}. They can set a password and complete setup."}
        raise HTTPException(status_code=409, detail="A user with this email already exists")

    existing_invite = await db.execute(
        select(UserInvitation).where(
            UserInvitation.email == data.email,
            UserInvitation.tenant_id == current_user.tenant_id,
            UserInvitation.accepted == False,  # noqa: E712
        )
    )
    old_inv = existing_invite.scalar_one_or_none()
    if old_inv:
        await db.delete(old_inv)
        await db.flush()

    now = utcnow_naive()
    token = secrets.token_urlsafe(64)
    invitation = UserInvitation(
        id=generate_uuid(),
        tenant_id=current_user.tenant_id,
        invited_by=current_user.id,
        email=data.email,
        token=token,
        role_name=data.role_name,
        expires_at=now + timedelta(hours=INVITE_TOKEN_HOURS),
        created_at=now,
    )
    db.add(invitation)
    await db.flush()

    settings = get_settings()
    # HashRouter uses # for routes; link must be /#/accept-invitation?token=... to reach the accept page
    invite_url = f"{settings.frontend_url}/#/accept-invitation?token={token}"

    tenant_r = await db.execute(select(Tenant).where(Tenant.id == current_user.tenant_id))
    tenant = tenant_r.scalar_one_or_none()
    company_name = tenant.company_name if tenant else "SSHCONTROL"

    from app.services.email_service import send_with_template
    try:
        await send_with_template(
            db,
            to_email=data.email,
            template_key="user_invitation",
            variables={
                "invited_by": current_user.full_name or current_user.username,
                "company_name": company_name,
                "action_url": invite_url,
                "expires_hours": str(INVITE_TOKEN_HOURS),
            },
            fallback_subject=f"You're invited to join {company_name} on SSHCONTROL",
            fallback_html=(
                f"<p>You've been invited to join <strong>{company_name}</strong> on SSHCONTROL.</p>"
                f'<p><a href="{invite_url}">Click here to accept</a></p>'
                f"<p>This invitation expires in {INVITE_TOKEN_HOURS} hours.</p>"
            ),
        )
    except Exception as e:
        logger.warning("Invitation email failed: %s", e)

    await audit_service.log(
        db, "user_invited",
        resource_type="user", resource_id=invitation.id,
        user_id=str(current_user.id), username=current_user.username,
        details=f"email={data.email} role={data.role_name}",
    )
    return {"message": f"Invitation sent to {data.email}", "invitation_id": invitation.id}
