"""Platform-wide settings: Google Analytics, Ads, SEO, Stripe, renewal reminders."""

from sqlalchemy import Column, String, Text, DateTime, Boolean, Integer
from app.database import Base
from app.models.user import utcnow_naive


class PlatformSettings(Base):
    """Singleton row (id='1') for Google Analytics, Google Ads, SEO, Stripe, etc."""
    __tablename__ = "platform_settings"

    id = Column(String(36), primary_key=True, default="1")
    google_analytics_id = Column(String(50), nullable=False, default="")
    google_ads_id = Column(String(50), nullable=False, default="")
    google_ads_conversion_label = Column(String(100), nullable=False, default="")
    google_tag_manager_id = Column(String(50), nullable=False, default="")
    google_oauth_client_id = Column(String(255), nullable=False, default="")
    google_oauth_client_secret = Column(String(500), nullable=False, default="")
    recaptcha_site_key = Column(String(100), nullable=False, default="")
    recaptcha_secret_key = Column(String(255), nullable=False, default="")
    seo_site_title = Column(String(100), nullable=False, default="SSHCONTROL")
    seo_meta_description = Column(Text, nullable=True)
    seo_keywords = Column(String(500), nullable=False, default="")
    seo_og_image_url = Column(String(500), nullable=False, default="")
    # Stripe
    stripe_secret_key = Column(String(255), nullable=False, default="")
    stripe_publishable_key = Column(String(255), nullable=False, default="")
    stripe_webhook_secret = Column(String(255), nullable=False, default="")
    stripe_enabled = Column(Boolean, default=False, nullable=False)
    # Renewal reminders: days before expiry, which channels
    renewal_reminder_days_before = Column(Integer, default=3, nullable=False)
    renewal_reminder_send_email = Column(Boolean, default=True, nullable=False)
    renewal_reminder_send_sms = Column(Boolean, default=False, nullable=False)
    renewal_reminder_send_notification = Column(Boolean, default=True, nullable=False)
    # Overdue: email to receive daily reminders when paid plans are past due (e.g. info@sshcontrol.com)
    overdue_reminder_email = Column(String(255), nullable=False, default="info@sshcontrol.com")
    updated_at = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)
