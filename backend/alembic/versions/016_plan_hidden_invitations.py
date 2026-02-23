"""Add is_hidden to plans, user_invitations table

Revision ID: 016
Revises: 015
Create Date: 2026-02-22

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "016"
down_revision: Union[str, None] = "015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # Add is_hidden to plans (for custom plans not shown publicly)
    col_exists = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
        "WHERE table_name='plans' AND column_name='is_hidden')"
    )).scalar()
    if not col_exists:
        op.add_column("plans", sa.Column("is_hidden", sa.Boolean(), nullable=False, server_default=sa.false()))

    # User invitations table
    tbl_exists = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
        "WHERE table_schema='public' AND table_name='user_invitations')"
    )).scalar()
    if not tbl_exists:
        op.create_table(
            "user_invitations",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tenant_id", sa.String(36), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("invited_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("email", sa.String(255), nullable=False),
            sa.Column("token", sa.String(128), unique=True, nullable=False, index=True),
            sa.Column("role_name", sa.String(50), nullable=False, server_default="user"),
            sa.Column("accepted", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )

    # Seed invitation email template if not exists
    conn.execute(sa.text("""
        INSERT INTO email_templates (id, template_key, display_name, subject, body_html, updated_at)
        VALUES (
            'tpl-invitation', 'user_invitation', 'User Invitation',
            'You''re invited to join {{company_name}} on SSHCONTROL',
            '<div style="font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;"><div style="background:linear-gradient(135deg,#0a1628,#122a42);border-radius:16px;padding:40px;color:#e2e8f0;"><h1 style="color:#2dd4bf;margin:0 0 20px;">You''re Invited!</h1><p style="font-size:16px;line-height:1.6;">Hi,</p><p style="font-size:16px;line-height:1.6;"><strong>{{invited_by}}</strong> has invited you to join <strong>{{company_name}}</strong> on SSHCONTROL.</p><p style="font-size:16px;line-height:1.6;">Click the button below to create your account and get started.</p><div style="text-align:center;margin:32px 0;"><a href="{{action_url}}" style="display:inline-block;background:linear-gradient(135deg,#2dd4bf,#14b8a6);color:#022c22;font-weight:600;padding:14px 36px;border-radius:10px;text-decoration:none;font-size:16px;">Accept Invitation</a></div><p style="font-size:14px;color:#94a3b8;">This invitation expires in {{expires_hours}} hours.</p><p style="font-size:14px;color:#94a3b8;">If you didn''t expect this invitation, you can safely ignore this email.</p></div></div>',
            CURRENT_TIMESTAMP
        )
        ON CONFLICT (template_key) DO NOTHING
    """))


def downgrade() -> None:
    op.drop_table("user_invitations")
    op.drop_column("plans", "is_hidden")
