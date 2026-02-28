"""Google reCAPTCHA verification."""

import json
import logging
import urllib.request
import urllib.parse

logger = logging.getLogger(__name__)

VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify"


def verify_recaptcha(token: str, secret_key: str, remote_ip: str | None = None) -> bool:
    """
    Verify a reCAPTCHA response token with Google.
    Returns True if verification succeeds, False otherwise.
    """
    if not token or not secret_key:
        return False
    data = urllib.parse.urlencode({
        "secret": secret_key,
        "response": token,
        **({"remoteip": remote_ip} if remote_ip else {}),
    }).encode()
    try:
        req = urllib.request.Request(VERIFY_URL, data=data, method="POST")
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read().decode())
            success = body.get("success", False)
            if not success:
                logger.warning("reCAPTCHA verification failed: %s", body.get("error-codes", []))
            return success
    except Exception as e:
        logger.warning("reCAPTCHA verification request failed: %s", e)
        return False
