"""Platform-wide email configuration and editable email templates, stored in DB."""

from sqlalchemy import Column, String, Text, Boolean, DateTime
from app.database import Base
from app.models.user import generate_uuid, utcnow_naive


class EmailSettings(Base):
    """Singleton row (id='1') holding SendGrid credentials and sender info."""
    __tablename__ = "email_settings"

    id = Column(String(36), primary_key=True, default="1")
    sendgrid_api_key = Column(String(255), nullable=False, default="")
    from_email = Column(String(255), nullable=False, default="noreply@sshcontrol.com")
    from_name = Column(String(255), nullable=False, default="SSHCONTROL")
    enabled = Column(Boolean, nullable=False, default=False)
    updated_at = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)


class EmailTemplate(Base):
    """
    One row per template type.  Template keys:
      - verify_email
      - password_reset
      - welcome
    The `subject` and `body_html` fields support placeholders:
      {{full_name}}, {{action_url}}, {{expires_hours}}, {{company_name}}
    """
    __tablename__ = "email_templates"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    template_key = Column(String(50), unique=True, nullable=False, index=True)
    display_name = Column(String(100), nullable=False)
    subject = Column(String(255), nullable=False)
    body_html = Column(Text, nullable=False)
    updated_at = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)
