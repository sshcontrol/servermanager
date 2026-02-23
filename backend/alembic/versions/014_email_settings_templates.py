"""Email settings and editable email templates (stored in DB)

Revision ID: 014
Revises: 013
Create Date: 2026-02-09

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "014"
down_revision: Union[str, None] = "013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# ── Default HTML templates ────────────────────────────────────────────────────
_WRAPPER_START = (
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;'
    'max-width:600px;margin:0 auto;padding:40px 20px;">'
    '<div style="background:linear-gradient(135deg,#0a1628,#122a42);border-radius:16px;'
    'padding:40px;color:#e2e8f0;">'
)
_WRAPPER_END = '</div></div>'
_BTN = (
    '<div style="text-align:center;margin:32px 0;">'
    '<a href="{{action_url}}" style="display:inline-block;background:linear-gradient(135deg,#2dd4bf,#14b8a6);'
    'color:#022c22;font-weight:600;padding:14px 36px;border-radius:10px;text-decoration:none;font-size:16px;">'
)

VERIFY_BODY = (
    f'{_WRAPPER_START}'
    '<h1 style="color:#2dd4bf;margin:0 0 20px;">Welcome to SSHCONTROL</h1>'
    '<p style="font-size:16px;line-height:1.6;">Hi {{full_name}},</p>'
    '<p style="font-size:16px;line-height:1.6;">Thank you for signing up! '
    'Please verify your email address to activate your account.</p>'
    f'{_BTN}Verify Email Address</a></div>'
    '<p style="font-size:14px;color:#94a3b8;">This link expires in {{expires_hours}} hours.</p>'
    '<p style="font-size:14px;color:#94a3b8;">If you didn\'t create this account, you can safely ignore this email.</p>'
    f'{_WRAPPER_END}'
)

RESET_BODY = (
    f'{_WRAPPER_START}'
    '<h1 style="color:#2dd4bf;margin:0 0 20px;">Password Reset</h1>'
    '<p style="font-size:16px;line-height:1.6;">Hi {{full_name}},</p>'
    '<p style="font-size:16px;line-height:1.6;">We received a request to reset your password. '
    'Click below to set a new password.</p>'
    f'{_BTN}Reset Password</a></div>'
    '<p style="font-size:14px;color:#94a3b8;">This link expires in {{expires_hours}} hour(s).</p>'
    '<p style="font-size:14px;color:#94a3b8;">If you didn\'t request this, you can safely ignore this email.</p>'
    f'{_WRAPPER_END}'
)

WELCOME_BODY = (
    f'{_WRAPPER_START}'
    '<h1 style="color:#2dd4bf;margin:0 0 20px;">Welcome aboard!</h1>'
    '<p style="font-size:16px;line-height:1.6;">Hi {{full_name}},</p>'
    '<p style="font-size:16px;line-height:1.6;">Your email has been verified and your account is now active. '
    'Log in to start managing your servers.</p>'
    f'{_BTN}Go to Dashboard</a></div>'
    f'{_WRAPPER_END}'
)


def upgrade() -> None:
    # email_settings – singleton config row
    op.create_table(
        "email_settings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("sendgrid_api_key", sa.String(255), nullable=False, server_default=""),
        sa.Column("from_email", sa.String(255), nullable=False, server_default="noreply@sshcontrol.com"),
        sa.Column("from_name", sa.String(255), nullable=False, server_default="SSHCONTROL"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.execute(sa.text(
        "INSERT INTO email_settings (id, sendgrid_api_key, from_email, from_name, enabled, updated_at) "
        "VALUES ('1', '', 'noreply@sshcontrol.com', 'SSHCONTROL', false, CURRENT_TIMESTAMP)"
    ))

    # email_templates
    op.create_table(
        "email_templates",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("template_key", sa.String(50), unique=True, nullable=False),
        sa.Column("display_name", sa.String(100), nullable=False),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("body_html", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_email_templates_template_key", "email_templates", ["template_key"])

    # Seed default templates
    import uuid
    for key, name, subject, body in [
        ("verify_email", "Email Verification", "Verify your SSHCONTROL account", VERIFY_BODY),
        ("password_reset", "Password Reset", "Reset your SSHCONTROL password", RESET_BODY),
        ("welcome", "Welcome Email", "Welcome to SSHCONTROL", WELCOME_BODY),
    ]:
        tid = str(uuid.uuid4())
        op.execute(sa.text(
            "INSERT INTO email_templates (id, template_key, display_name, subject, body_html, updated_at) "
            "VALUES (:id, :key, :name, :subject, :body, CURRENT_TIMESTAMP)"
        ).bindparams(id=tid, key=key, name=name, subject=subject, body=body))


def downgrade() -> None:
    op.drop_index("ix_email_templates_template_key", "email_templates")
    op.drop_table("email_templates")
    op.drop_table("email_settings")
