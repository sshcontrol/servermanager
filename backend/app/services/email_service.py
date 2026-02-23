"""Email service using the official SendGrid Python SDK.

All configuration (API key, sender, enabled flag) and email body templates
are stored in the database and editable via the superadmin panel.
"""

import logging
import os
import secrets
from datetime import timedelta
from typing import Optional

from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail, Email, To, Content
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import get_settings
from app.models.user import utcnow_naive
from app.models.email_settings import EmailSettings, EmailTemplate
from app.models.tenant import EmailVerificationToken, PasswordResetToken, DestructiveVerificationToken

logger = logging.getLogger(__name__)

VERIFY_TOKEN_HOURS = 48
RESET_TOKEN_HOURS = 1


# ── helpers ──────────────────────────────────────────────────────────────────

async def _get_email_settings(db: AsyncSession) -> Optional[EmailSettings]:
    result = await db.execute(select(EmailSettings).where(EmailSettings.id == "1"))
    return result.scalar_one_or_none()


async def _get_template(db: AsyncSession, template_key: str) -> Optional[EmailTemplate]:
    result = await db.execute(
        select(EmailTemplate).where(EmailTemplate.template_key == template_key)
    )
    return result.scalar_one_or_none()


def _resolve_api_key(db_key: str) -> str:
    """Return the DB-stored key if non-empty, else fall back to env / config."""
    if db_key:
        return db_key
    settings = get_settings()
    return settings.sendgrid_api_key or os.environ.get("SENDGRID_API_KEY", "")


def _render(html: str, variables: dict[str, str]) -> str:
    """Replace {{placeholder}} tokens in the template body."""
    for key, value in variables.items():
        html = html.replace("{{" + key + "}}", value)
    return html


# ── core send ────────────────────────────────────────────────────────────────

async def _send_email(
    db: AsyncSession,
    to_email: str,
    subject: str,
    html_content: str,
) -> bool:
    """Send an email via SendGrid Web API v3."""
    cfg = await _get_email_settings(db)
    api_key = _resolve_api_key(cfg.sendgrid_api_key if cfg else "")
    if not api_key:
        logger.warning("SendGrid API key not configured; email to %s skipped", to_email)
        return False

    if cfg and not cfg.enabled:
        logger.info("Email sending disabled in settings; email to %s skipped", to_email)
        return False

    from_email = (cfg.from_email if cfg and cfg.from_email else "noreply@sshcontrol.com")
    from_name = (cfg.from_name if cfg and cfg.from_name else "SSHCONTROL")

    message = Mail(
        from_email=Email(from_email, from_name),
        to_emails=To(to_email),
        subject=subject,
        html_content=Content("text/html", html_content),
    )

    try:
        sg = SendGridAPIClient(api_key)
        response = sg.send(message)
        if response.status_code in (200, 201, 202):
            logger.info("Email sent to %s (status %d): %s", to_email, response.status_code, subject)
            return True
        logger.error("SendGrid returned %d for %s", response.status_code, to_email)
        return False
    except Exception as e:
        logger.exception("Failed to send email to %s: %s", to_email, e)
        return False


# ── public helpers ───────────────────────────────────────────────────────────

async def send_with_template(
    db: AsyncSession,
    to_email: str,
    template_key: str,
    variables: dict[str, str],
    fallback_subject: str = "",
    fallback_html: str = "",
) -> bool:
    """Load a template from DB, render it with variables, and send."""
    tpl = await _get_template(db, template_key)
    if tpl:
        subject = _render(tpl.subject, variables)
        html = _render(tpl.body_html, variables)
    else:
        subject = fallback_subject
        html = fallback_html
        if not html:
            logger.warning("No template '%s' in DB and no fallback; email skipped", template_key)
            return False
    return await _send_email(db, to_email, subject, html)


# ── token creation ───────────────────────────────────────────────────────────

async def create_verification_token(db: AsyncSession, user_id: str) -> str:
    token = secrets.token_urlsafe(64)
    now = utcnow_naive()
    vt = EmailVerificationToken(
        user_id=user_id,
        token=token,
        expires_at=now + timedelta(hours=VERIFY_TOKEN_HOURS),
        created_at=now,
    )
    db.add(vt)
    await db.flush()
    return token


async def create_password_reset_token(db: AsyncSession, user_id: str) -> str:
    token = secrets.token_urlsafe(64)
    now = utcnow_naive()
    rt = PasswordResetToken(
        user_id=user_id,
        token=token,
        expires_at=now + timedelta(hours=RESET_TOKEN_HOURS),
        created_at=now,
    )
    db.add(rt)
    await db.flush()
    return token


# ── high-level senders ───────────────────────────────────────────────────────

async def send_verification_email(
    db: AsyncSession, user_id: str, email: str, full_name: str
) -> bool:
    token = await create_verification_token(db, user_id)
    settings = get_settings()
    # Link goes to the backend GET endpoint which verifies and redirects to frontend
    verify_url = f"{settings.frontend_url}/api/public/verify-email?token={token}"

    return await send_with_template(
        db,
        to_email=email,
        template_key="verify_email",
        variables={
            "full_name": full_name,
            "action_url": verify_url,
            "expires_hours": str(VERIFY_TOKEN_HOURS),
        },
        fallback_subject="Verify your SSHCONTROL account",
        fallback_html=(
            f"<p>Hi {full_name},</p>"
            f'<p>Please verify your email: <a href="{verify_url}">{verify_url}</a></p>'
            f"<p>This link expires in {VERIFY_TOKEN_HOURS} hours.</p>"
        ),
    )


async def send_password_reset_email(
    db: AsyncSession, user_id: str, email: str, full_name: str
) -> bool:
    token = await create_password_reset_token(db, user_id)
    settings = get_settings()
    # HashRouter uses # for routes
    reset_url = f"{settings.frontend_url}/#/reset-password?token={token}"

    return await send_with_template(
        db,
        to_email=email,
        template_key="password_reset",
        variables={
            "full_name": full_name,
            "action_url": reset_url,
            "expires_hours": str(RESET_TOKEN_HOURS),
        },
        fallback_subject="Reset your SSHCONTROL password",
        fallback_html=(
            f"<p>Hi {full_name},</p>"
            f'<p>Reset your password: <a href="{reset_url}">{reset_url}</a></p>'
            f"<p>This link expires in {RESET_TOKEN_HOURS} hour.</p>"
        ),
    )


DESTRUCTIVE_CODE_EXPIRE_MINUTES = 10


async def send_destructive_verification_email(
    db: AsyncSession,
    user_id: str,
    email: str,
    full_name: str,
    action: str,
    target_id: str,
    target_name: str,
) -> tuple[bool, str]:
    """Send 4-digit verification code for destructive action. Returns (success, code)."""
    import secrets
    code = "".join(secrets.choice("0123456789") for _ in range(4))
    now = utcnow_naive()
    expires_at = now + timedelta(minutes=DESTRUCTIVE_CODE_EXPIRE_MINUTES)

    # Invalidate any existing tokens for this user+action
    from sqlalchemy import delete
    await db.execute(
        delete(DestructiveVerificationToken).where(
            DestructiveVerificationToken.user_id == user_id,
            DestructiveVerificationToken.action == action,
        )
    )
    await db.flush()

    token = DestructiveVerificationToken(
        user_id=user_id,
        action=action,
        target_id=target_id,
        code=code,
        expires_at=expires_at,
        created_at=now,
    )
    db.add(token)
    await db.flush()

    action_label = {
        "delete_server": "remove a server",
        "delete_user": "remove a user",
        "delete_server_group": "remove a server group",
        "delete_user_group": "remove a user group",
    }.get(action, action)

    html = (
        f'<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:30px;">'
        f'<h2 style="color:#2dd4bf;">Verification Code</h2>'
        f'<p>Hi {full_name or "there"},</p>'
        f'<p>You requested to {action_label} (<strong>{target_name}</strong>).</p>'
        f'<p>Your verification code is: <strong style="font-size:1.5em;letter-spacing:0.2em;">{code}</strong></p>'
        f'<p>This code expires in {DESTRUCTIVE_CODE_EXPIRE_MINUTES} minutes.</p>'
        f'<p>If you did not request this, please ignore this email and secure your account.</p>'
        f'</div>'
    )
    sent = await _send_email(
        db,
        to_email=email,
        subject="SSHCONTROL - Verification code for removal",
        html_content=html,
    )
    return sent, code


async def send_test_email(db: AsyncSession, to_email: str) -> bool:
    """Send a plain test email to verify SendGrid integration works."""
    html = (
        '<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:30px;">'
        '<h2 style="color:#2dd4bf;">SSHCONTROL Email Test</h2>'
        '<p>If you received this email, your SendGrid integration is working correctly.</p>'
        '</div>'
    )
    return await _send_email(db, to_email, "SSHCONTROL - Test Email", html)
