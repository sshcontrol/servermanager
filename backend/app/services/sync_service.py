"""Run sync on target servers via SSH using the platform key."""

import io
import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import TYPE_CHECKING

import paramiko

if TYPE_CHECKING:
    from app.models.server import Server


def _run_sync_on_server_sync(
    host: str,
    port: int,
    private_key_pem: str,
    timeout_seconds: int = 45,
) -> dict:
    """
    Synchronously SSH to server and run sync scripts.
    Returns {success: bool, error?: str, output?: str}.
    """
    if not host or not host.strip():
        return {"success": False, "error": "Server has no IP address or hostname configured"}
    host = host.strip()
    # From inside Docker, localhost/127.0.0.1 cannot reach the host; use host.docker.internal
    if host in ("localhost", "127.0.0.1", "::1"):
        host = "host.docker.internal"
    try:
        key = paramiko.RSAKey.from_private_key(io.StringIO(private_key_pem))
    except Exception as e:
        return {"success": False, "error": f"Invalid platform key: {e}"}
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            hostname=host,
            port=port,
            username="root",
            pkey=key,
            timeout=15,
            banner_timeout=15,
        )
    except paramiko.SSHException as e:
        return {"success": False, "error": f"SSH connection failed: {e}"}
    except Exception as e:
        return {"success": False, "error": str(e)}
    try:
        # Run both sync scripts (authorized_keys for root, users for per-user accounts)
        cmd = "sudo /etc/sshcontrol/sync-authorized-keys.sh 2>&1; sudo /etc/sshcontrol/sync-users.sh 2>&1"
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout_seconds)
        exit_status = stdout.channel.recv_exit_status()
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        combined = (out + "\n" + err).strip() if (out or err) else ""
        if exit_status != 0:
            return {
                "success": False,
                "error": f"Sync exited with code {exit_status}",
                "output": combined[:2000] if combined else None,
            }
        return {"success": True, "output": combined[:500] if combined else None}
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        client.close()


async def run_sync_on_server(
    server: "Server",
    private_key_pem: str | None,
    timeout_seconds: int = 45,
    executor: ThreadPoolExecutor | None = None,
) -> dict:
    """
    Run sync on a target server via SSH. Returns {success, error?, output?}.
    """
    host = (server.ip_address or "").strip() or (server.hostname or "").strip()
    if not private_key_pem:
        return {"success": False, "error": "Platform SSH key not configured"}
    loop = asyncio.get_event_loop()
    _executor = executor or ThreadPoolExecutor(max_workers=4)
    return await loop.run_in_executor(
        _executor,
        _run_sync_on_server_sync,
        host,
        22,
        private_key_pem,
        timeout_seconds,
    )


async def run_sync_on_servers(
    servers: list["Server"],
    private_key_pem: str | None,
    timeout_seconds: int = 45,
) -> list[dict]:
    """
    Run sync on multiple servers. Returns list of {server_id, server_name, success, error?, output?}.
    """
    results = []
    for srv in servers:
        result = await run_sync_on_server(srv, private_key_pem, timeout_seconds)
        name = getattr(srv, "friendly_name", None) or getattr(srv, "hostname", "") or srv.id
        results.append({
            "server_id": srv.id,
            "server_name": name,
            "success": result.get("success", False),
            "error": result.get("error"),
            "output": result.get("output"),
        })
    return results
