"""Payment transactions synced from Stripe."""

from sqlalchemy import Column, String, DateTime, ForeignKey, Numeric, Text
from app.database import Base
from app.models.user import generate_uuid, utcnow_naive


class PaymentTransaction(Base):
    __tablename__ = "payment_transactions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True)
    company_name = Column(String(255), nullable=True)  # Preserved when tenant is deleted
    plan_id = Column(String(36), ForeignKey("plans.id", ondelete="SET NULL"), nullable=True, index=True)
    stripe_payment_intent_id = Column(String(255), nullable=True, index=True)
    stripe_invoice_id = Column(String(255), nullable=True, index=True)
    amount = Column(Numeric(12, 2), nullable=False)
    currency = Column(String(3), nullable=False, default="USD")
    status = Column(String(50), nullable=False)  # succeeded, failed, pending, refunded
    failure_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)
