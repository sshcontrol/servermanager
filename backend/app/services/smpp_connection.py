"""Persistent SMPP connection manager with keep-alive.

Maintains a bound connection and sends enquire_link every 30 seconds to prevent
idle timeout. Reconnects automatically when the connection drops.
"""

import logging
import smpplib.client
import smpplib.consts
import smpplib.gsm
import smpplib.smpp
import threading
import time
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

KEEPALIVE_INTERVAL_SEC = 30
SOCKET_TIMEOUT = 15


class SMPPConnectionManager:
    """Singleton that holds a persistent SMPP connection and runs keep-alive."""

    _instance: Optional["SMPPConnectionManager"] = None
    _lock = threading.Lock()

    def __new__(cls) -> "SMPPConnectionManager":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        if hasattr(self, "_initialized") and self._initialized:
            return
        self._initialized = True
        self._client: Optional[smpplib.client.Client] = None
        self._params: Optional[Tuple[str, int, str, str, str]] = None  # host, port, system_id, password, sender
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._conn_lock = threading.Lock()

    def _connect_and_bind(
        self,
        host: str,
        port: int,
        system_id: str,
        password: str,
    ) -> bool:
        """Connect and bind. Returns True on success."""
        try:
            client = smpplib.client.Client(
                host,
                port,
                timeout=SOCKET_TIMEOUT,
                allow_unknown_opt_params=True,
            )
            client.connect()
            client.bind_transceiver(system_id=system_id, password=password)
            self._client = client
            logger.info("SMPP connected and bound to %s:%d", host, port)
            return True
        except Exception as e:
            logger.warning("SMPP connect/bind failed: %s", e)
            return False

    def _disconnect(self) -> None:
        """Safely disconnect and clear client."""
        client = self._client
        self._client = None
        if client:
            try:
                client.unbind()
            except Exception as e:
                logger.debug("SMPP unbind: %s", e)
            try:
                client.disconnect()
            except Exception as e:
                logger.debug("SMPP disconnect: %s", e)

    def _send_enquire_link(self) -> bool:
        """Send enquire_link and read response. Returns True if connection is healthy."""
        client = self._client
        if not client or not client._socket:
            return False
        try:
            pdu = smpplib.smpp.make_pdu("enquire_link", client=client)
            client.send_pdu(pdu)
            resp = client.read_pdu()
            if resp.command == "enquire_link_resp" and not resp.is_error():
                return True
            return False
        except Exception as e:
            logger.debug("SMPP enquire_link failed: %s", e)
            return False

    def _keepalive_loop(self) -> None:
        """Background thread: every KEEPALIVE_INTERVAL_SEC, check connection and reconnect if needed."""
        logger.info("SMPP keep-alive thread started (interval=%ds)", KEEPALIVE_INTERVAL_SEC)
        while not self._stop.wait(KEEPALIVE_INTERVAL_SEC):
            params = self._params
            if not params:
                continue
            host, port, system_id, password, _ = params
            with self._conn_lock:
                if self._send_enquire_link():
                    continue
                logger.warning("SMPP connection lost or unhealthy, reconnecting...")
                self._disconnect()
                if self._connect_and_bind(host, port, system_id, password):
                    logger.info("SMPP reconnected successfully")
                else:
                    logger.warning("SMPP reconnect failed, will retry on next cycle")

    def ensure_connected(
        self,
        host: str,
        port: int,
        system_id: str,
        password: str,
        sender: str,
    ) -> Optional[smpplib.client.Client]:
        """
        Ensure we have a healthy bound connection. Reconnect if needed.
        Returns the client if ready, None if connection failed.
        """
        params = (host, port, system_id, password, sender)
        with self._conn_lock:
            if self._params != params:
                self._disconnect()
                self._params = params
                if not self._connect_and_bind(host, port, system_id, password):
                    return None
                if self._thread is None or not self._thread.is_alive():
                    self._stop.clear()
                    self._thread = threading.Thread(target=self._keepalive_loop, daemon=True)
                    self._thread.start()
            elif self._client and not self._send_enquire_link():
                self._disconnect()
                if not self._connect_and_bind(host, port, system_id, password):
                    return None
            return self._client

    def send_message(
        self,
        client: smpplib.client.Client,
        to_phone: str,
        message: str,
        sender: str,
    ) -> Tuple[bool, str]:
        """Send SMS using the given client. Returns (success, error_message)."""
        dest_addr = to_phone.lstrip("+").replace(" ", "").replace("-", "")
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
                return False, f"SMPP error ({err}): {desc}"

        logger.info("SMS sent to %s***", to_phone[:6])
        return True, ""

    def shutdown(self) -> None:
        """Stop keep-alive thread and disconnect. Call on app shutdown."""
        self._stop.set()
        with self._conn_lock:
            self._disconnect()
            self._params = None
        logger.info("SMPP connection manager shut down")
