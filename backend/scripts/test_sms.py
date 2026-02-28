#!/usr/bin/env python3
"""
Test SMPP connection and send a test SMS.

Usage (Docker - recommended):
  docker compose exec backend python -m scripts.test_sms +1234567890

Usage (from backend dir, with venv activated):
  python -m scripts.test_sms +1234567890
  python scripts/test_sms.py +1234567890

Usage (from backend/scripts dir):
  python test_sms.py +1234567890

Ensures SMPP settings exist with defaults if empty, then sends a test message.
"""
import asyncio
import os
import sys
from pathlib import Path

# Add backend to path
backend = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend))
os.chdir(backend)

DEFAULT_LINK = "http://65.108.18.8:2775"
DEFAULT_USERNAME = "ssh-cont1"
DEFAULT_PASSWORD = "1ksKtAQ1"


async def main():
    if len(sys.argv) < 2:
        print("Usage: python -m scripts.test_sms <phone_e164>")
        print("Example: python -m scripts.test_sms +1234567890")
        sys.exit(1)

    to_phone = sys.argv[1].strip()
    if len(to_phone) < 10:
        print("Error: Phone number too short. Use E.164 format (e.g. +1234567890)")
        sys.exit(1)

    from app.database import AsyncSessionLocal
    from app.models.smpp_settings import SmppSettings
    from app.models.user import utcnow_naive
    from app.services import sms_service
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(SmppSettings).where(SmppSettings.id == "1"))
        cfg = result.scalar_one_or_none()

        if not cfg:
            cfg = SmppSettings(id="1", updated_at=utcnow_naive())
            db.add(cfg)
            await db.flush()

        # Apply defaults if empty
        if not (cfg.link and cfg.username and cfg.password):
            cfg.link = cfg.link or DEFAULT_LINK
            cfg.username = cfg.username or DEFAULT_USERNAME
            cfg.password = cfg.password or DEFAULT_PASSWORD
            cfg.enabled = True
            await db.flush()
            await db.commit()
            print(f"Applied defaults: link={cfg.link}, username={cfg.username}, enabled={cfg.enabled}")

        print(f"Sending test SMS to {to_phone}...")
        ok, err = await sms_service.send_sms(db, to_phone, "SSHCONTROL test: SMS gateway connected successfully.")
        if ok:
            print("SUCCESS: Test SMS sent.")
        else:
            print(f"FAILED: {err or 'Could not send SMS. Check SMPP gateway URL, credentials, and that the service is enabled.'}")
            sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
