"""SMS sending via SMPP gateway (native SMPP protocol using smpplib)."""

import asyncio
import logging
from typing import Optional, Tuple
from urllib.parse import urlparse

import smpplib.client
import smpplib.consts
import smpplib.gsm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.smpp_settings import SmppSettings

logger = logging.getLogger(__name__)


def _parse_host_port(link: str) -> Tuple[str, int]:
    """Parse SMPP gateway link to (host, port). Supports host:port or http(s)://host:port."""
    link = link.strip().rstrip("/")
    if not link:
        return "", 2775
    if "://" in link:
        scheme = "http" if not link.startswith("http") else ""
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
    Send SMS via native SMPP protocol. Runs synchronously (call from thread).
    """
    if not host or not system_id or not password:
        return False, "SMPP host and credentials required"

    try:
        client = smpplib.client.Client(
            host,
            port,
            timeout=15,
            allow_unknown_opt_params=True,
        )
        client.connect()
        client.bind_transceiver(system_id=system_id, password=password)

        # Normalize phone: strip + for SMPP, use digits only
        dest_addr = to_phone.lstrip("+").replace(" ", "").replace("-", "")

        # Handle Unicode and long messages via make_parts
        parts, encoding_flag, msg_type_flag = smpplib.gsm.make_parts(message)

        for part in parts:
            if isinstance(part, str):
                part = part.encode("utf-8")
            client.send_message(
                source_addr_ton=smpplib.consts.SMPP_TON_ALNUM,
                source_addr_npi=smpplib.consts.SMPP_NPI_UNK,
                source_addr=sender,
                dest_addr_ton=smpplib.consts.SMPP_TON_INTL,
                dest_addr_npi=smpplib.consts.SMPP_NPI_ISDN,
                destination_addr=dest_addr,
                short_message=part,
                data_coding=encoding_flag,
                esm_class=msg_type_flag,
                registered_delivery=1,
            )
            resp = client.read_pdu()
            if resp.command != "submit_sm_resp" or resp.is_error():
                err = getattr(resp, "status", None)
                desc = smpplib.consts.DESCRIPTIONS.get(err, "Unknown") if err else "Send failed"
                client.unbind()
                client.disconnect()
                return False, f"SMPP error ({err}): {desc}"

        client.unbind()
        client.disconnect()
        logger.info("SMS sent to %s***", to_phone[:6])
        return True, ""
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
