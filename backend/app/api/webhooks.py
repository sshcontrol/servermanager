"""Webhook handlers for Stripe, SMPP, etc."""

import json
import logging
from urllib.parse import parse_qs
from typing import Annotated, Any

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import PlatformSettings, SmppCallback
from app.services.stripe_service import handle_checkout_completed, handle_invoice_paid, handle_subscription_updated
from sqlalchemy import select

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
logger = logging.getLogger(__name__)


def _parse_smpp_payload(content_type: str, body: bytes) -> dict[str, Any]:
    """Parse SMPP callback payload from JSON, form-urlencoded, or raw body."""
    payload: dict[str, Any] = {}
    if "application/json" in content_type and body:
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            payload = {"raw": body.decode("utf-8", errors="replace")}
    elif "application/x-www-form-urlencoded" in content_type and body:
        try:
            decoded = body.decode("utf-8", errors="replace")
            parsed = parse_qs(decoded, keep_blank_values=True)
            payload = {k: (v[0] if len(v) == 1 else v) for k, v in parsed.items()}
        except Exception:
            payload = {"raw": body.decode("utf-8", errors="replace")}
    elif body:
        payload = {"raw": body.decode("utf-8", errors="replace")}
    return payload


@router.post("/stripe")
async def stripe_webhook(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    stripe_signature: Annotated[str | None, Header(alias="Stripe-Signature")] = None,
):
    """Handle Stripe webhook events. Verifies signature and processes checkout.session.completed."""
    if not stripe_signature:
        logger.warning("Stripe webhook: missing Stripe-Signature header")
        raise HTTPException(status_code=400, detail="Missing Stripe-Signature header")

    result = await db.execute(select(PlatformSettings).where(PlatformSettings.id == "1"))
    cfg = result.scalar_one_or_none()
    if not cfg:
        raise HTTPException(status_code=500, detail="Platform not configured")
    webhook_secret = getattr(cfg, "stripe_webhook_secret", None) or ""
    secret_key = getattr(cfg, "stripe_secret_key", None) or ""
    if not webhook_secret or not secret_key:
        raise HTTPException(status_code=500, detail="Stripe webhook not configured")

    body = await request.body()
    try:
        event = stripe.Webhook.construct_event(body, stripe_signature, webhook_secret)
    except ValueError as e:
        logger.warning("Stripe webhook invalid payload: %s", e)
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.SignatureVerificationError as e:
        logger.warning(
            "Stripe webhook signature verification failed: %s. "
            "Ensure webhook secret matches Stripe mode (test vs live). "
            "Create a separate webhook endpoint in Stripe Dashboard for live mode and use its signing secret.",
            e,
        )
        raise HTTPException(status_code=400, detail="Invalid signature")

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        session_id = session.get("id")
        payment_intent_id = session.get("payment_intent")
        customer_id = session.get("customer")
        subscription_id = session.get("subscription")
        invoice_id = session.get("invoice")
        if session_id:
            await handle_checkout_completed(
                db, session_id, payment_intent_id, customer_id,
                subscription_id=subscription_id, invoice_id=invoice_id,
            )
            await db.commit()
    elif event["type"] == "invoice.paid":
        invoice = event["data"]["object"]
        await handle_invoice_paid(db, invoice)
        await db.commit()
    elif event["type"] in ("customer.subscription.updated", "customer.subscription.deleted"):
        subscription = event["data"]["object"]
        await handle_subscription_updated(db, subscription)
        await db.commit()
    else:
        logger.debug("Stripe webhook unhandled event type: %s", event["type"])

    return {"received": True}


def _record_smpp_callback(db: AsyncSession, payload: dict[str, Any]) -> None:
    """Extract fields and persist an SmppCallback record."""
    callback_type = (
        payload.get("type")
        or payload.get("callback_type")
        or payload.get("event")
        or payload.get("dlr_status")
        or "unknown"
    )
    message_id = (
        payload.get("message_id")
        or payload.get("id")
        or payload.get("msg_id")
        or payload.get("messageId")
        or payload.get("sms_id")
    )
    status = (
        payload.get("status")
        or payload.get("state")
        or payload.get("delivery_status")
        or payload.get("dlr_status")
        or payload.get("result")
    )
    cb = SmppCallback(
        callback_type=str(callback_type)[:50],
        message_id=str(message_id)[:255] if message_id else None,
        status=str(status)[:50] if status else None,
        raw_payload=json.dumps(payload) if payload else None,
    )
    db.add(cb)
    logger.info("SMPP callback recorded: type=%s message_id=%s status=%s", callback_type, message_id, status)


@router.post("/smpp")
async def smpp_webhook_post(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Record SMPP callbacks (delivery reports, MO messages, etc.). Public endpoint called by SMPP provider.
    Accepts JSON, form-urlencoded, or raw body."""
    content_type = request.headers.get("content-type", "")
    body = await request.body()
    payload = _parse_smpp_payload(content_type, body)
    _record_smpp_callback(db, payload)
    await db.commit()
    return {"received": True}


@router.get("/smpp")
async def smpp_webhook_get(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Record SMPP callbacks sent via GET (query params). Some providers use GET for delivery reports."""
    payload = dict(request.query_params)
    if payload:
        _record_smpp_callback(db, payload)
        await db.commit()
    return {"received": True}
