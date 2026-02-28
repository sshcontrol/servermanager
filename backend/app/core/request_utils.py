"""Request utilities for extracting client IP behind reverse proxies."""

from fastapi import Request


def get_client_ip(request: Request) -> str:
    """Extract the real client IP from the request.

    When behind a reverse proxy (nginx, Cloudflare, etc.), request.client.host
    is the proxy's IP. Proxy headers (X-Forwarded-For, X-Real-IP, CF-Connecting-IP)
    contain the real client IP and must be preferred.
    """
    # Prefer proxy headers. Use X-Forwarded-For first - in proxy chains (NPM→frontend→backend),
    # intermediate nginx may overwrite X-Real-IP with $remote_addr (Docker IP). X-Forwarded-For
    # preserves the chain: "client, proxy1, proxy2" - leftmost is the real client.
    for header in ("x-forwarded-for", "x-real-ip", "cf-connecting-ip"):
        val = request.headers.get(header)
        if val:
            return val.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"
