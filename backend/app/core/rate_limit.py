"""In-memory rate limiter for auth endpoints (IP-based, sliding window).

Uses get_client_ip() which prefers proxy headers (X-Forwarded-For, X-Real-IP)
when behind nginx/Cloudflare. Runs periodic cleanup to prevent unbounded memory growth.
"""

import random
import time
from collections import defaultdict
from threading import Lock
from fastapi import HTTPException, Request

from app.core.request_utils import get_client_ip


class RateLimiter:
    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()
        self._last_cleanup = time.monotonic()

    def _maybe_cleanup(self, now: float) -> None:
        """Probabilistic cleanup to prevent unbounded memory growth."""
        if now - self._last_cleanup < 60:
            return
        if random.random() > 0.1:
            return
        self._last_cleanup = now
        cutoff = now - self.window_seconds
        stale = [k for k, v in self._hits.items() if not v or v[-1] < cutoff]
        for k in stale:
            del self._hits[k]

    def check(self, request: Request) -> None:
        ip = get_client_ip(request)
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            self._maybe_cleanup(now)
            hits = self._hits[ip]
            self._hits[ip] = [t for t in hits if t > cutoff]
            if len(self._hits[ip]) >= self.max_requests:
                raise HTTPException(
                    status_code=429,
                    detail="Too many requests. Please try again later.",
                )
            self._hits[ip].append(now)


login_limiter = RateLimiter(max_requests=10, window_seconds=60)
totp_limiter = RateLimiter(max_requests=10, window_seconds=60)
refresh_limiter = RateLimiter(max_requests=30, window_seconds=60)
