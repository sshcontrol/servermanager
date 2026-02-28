"""Google OAuth 2.0: token exchange and user info."""

import hashlib
import hmac
import json
import logging
import secrets
import time
from urllib.parse import urlencode

import httpx

logger = logging.getLogger(__name__)

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
SCOPES = ["openid", "email", "profile"]


def build_authorization_url(
    client_id: str,
    redirect_uri: str,
    state: str,
    prompt: str | None = None,
) -> str:
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "state": state,
        "access_type": "offline",
        "prompt": prompt or "select_account",
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


def create_state(mode: str, secret_key: str, accept_terms: bool = False) -> str:
    nonce = secrets.token_urlsafe(32)
    ts = str(int(time.time()))
    payload = f"{nonce}|{mode}|{ts}"
    if mode == "signup":
        payload += f"|{int(accept_terms)}"
    sig = hmac.new(secret_key.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{sig}.{payload}"


def verify_state(state: str, secret_key: str, max_age_seconds: int = 600) -> tuple[str, bool] | None:
    """Verify state and return (mode, accept_terms) or None if invalid."""
    try:
        sig_part, payload = state.split(".", 1)
        expected = hmac.new(secret_key.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig_part, expected):
            return None
        parts = payload.split("|")
        mode = parts[1]
        ts = int(parts[2])
        if time.time() - ts > max_age_seconds:
            return None
        accept_terms = parts[3] == "1" if len(parts) > 3 else False
        return (mode, accept_terms)
    except Exception:
        return None


async def exchange_code_for_tokens(
    code: str,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
) -> dict:
    """Exchange authorization code for access and refresh tokens."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if resp.status_code != 200:
        logger.warning("Google token exchange failed: %s %s", resp.status_code, resp.text[:200])
        raise ValueError("Google token exchange failed")
    return resp.json()


async def get_user_info(access_token: str) -> dict:
    """Fetch user profile from Google."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if resp.status_code != 200:
        logger.warning("Google userinfo failed: %s %s", resp.status_code, resp.text[:200])
        raise ValueError("Failed to fetch Google user info")
    data = resp.json()
    return {
        "google_id": data.get("id"),
        "email": data.get("email"),
        "name": data.get("name") or data.get("email", "").split("@")[0],
        "picture": data.get("picture"),
    }
