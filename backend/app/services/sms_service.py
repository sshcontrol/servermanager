"""SMS sending via SMPP gateway (native SMPP protocol using smpplib).

Uses a persistent connection with keep-alive (enquire_link every 30 seconds)
to prevent idle timeout. Reconnects automatically when the connection drops.
"""

import asyncio
import logging
from typing import Optional, Tuple
from urllib.parse import urlparse

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.smpp_settings import SmppSettings
from app.services.smpp_connection import SMPPConnectionManager

logger = logging.getLogger(__name__)


def _parse_host_port(link: str) -> Tuple[str, int]:
    """Parse SMPP gateway link to (host, port). Supports host:port or http(s)://host:port."""
    link = link.strip().rstrip("/")
    if not link:
        return "", 2775
    if "://" in link:
        parsed = urlparse(link if link.startswith("http") else "http://" + link)
        host = parsed.hostname or link.split("://", 1)[-1].split(":")[0].split("/")[0]
        port = parsed.port or 2775
    else:
        parts = link.rsplit(":", 1)
        host = parts[0]
        port = int(parts[1]) if len(parts) == 2 and parts[1].isdigit() else 2775
    return host, port


def _send_sms_sync(
    host: str,
    port: int,
    system_id: str,
    password: str,
    to_phone: str,
    message: str,
    sender: str,
) -> Tuple[bool, str]:
    """
    Send SMS via persistent SMPP connection. Uses connection manager with keep-alive.
    """
    if not host or not system_id or not password:
        return False, "SMPP host and credentials required"

    mgr = SMPPConnectionManager()
    client = mgr.ensure_connected(host, port, system_id, password, sender)
    if not client:
        return False, "SMPP connection failed"

    try:
        return mgr.send_message(client, to_phone, message, sender)
    except Exception as e:
        logger.warning("SMPP send failed: %s", e)
        return False, str(e)


async def _get_smpp_settings(db: AsyncSession) -> Optional[SmppSettings]:
    result = await db.execute(select(SmppSettings).where(SmppSettings.id == "1"))
    return result.scalar_one_or_none()


async def send_sms(
    db: AsyncSession,
    to_phone: str,
    message: str,
    sender_name: Optional[str] = None,
) -> Tuple[bool, str]:
    """
    Send SMS via configured SMPP gateway using native SMPP protocol.
    Link format: host:port or http://host:port (e.g. 65.108.18.8:2775).
    """
    cfg = await _get_smpp_settings(db)
    if not cfg or not cfg.enabled or not cfg.link or not cfg.username or not cfg.password:
        msg = "SMS not configured or disabled"
        logger.warning("%s; message to %s skipped", msg, to_phone[:6] + "***")
        return False, msg

    sender = sender_name or (getattr(cfg, "sender_name", None) if cfg else None) or "SSHCONTROL"
    host, port = _parse_host_port(cfg.link)

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None,
        _send_sms_sync,
        host,
        port,
        cfg.username,
        cfg.password,
        to_phone,
        message,
        sender,
    )
