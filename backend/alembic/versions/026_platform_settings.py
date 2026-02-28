"""Add platform_settings table for Google Analytics, Ads, SEO

Revision ID: 026
Revises: 025
Create Date: 2026-02-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "026"
down_revision: Union[str, None] = "025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "platform_settings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("google_analytics_id", sa.String(50), nullable=False, server_default=""),
        sa.Column("google_ads_id", sa.String(50), nullable=False, server_default=""),
        sa.Column("google_ads_conversion_label", sa.String(100), nullable=False, server_default=""),
        sa.Column("google_tag_manager_id", sa.String(50), nullable=False, server_default=""),
        sa.Column("google_oauth_client_id", sa.String(255), nullable=False, server_default=""),
        sa.Column("google_oauth_client_secret", sa.String(500), nullable=False, server_default=""),
        sa.Column("seo_site_title", sa.String(100), nullable=False, server_default="SSHCONTROL"),
        sa.Column("seo_meta_description", sa.Text(), nullable=True),
        sa.Column("seo_keywords", sa.String(500), nullable=False, server_default=""),
        sa.Column("seo_og_image_url", sa.String(500), nullable=False, server_default=""),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.execute(sa.text(
        "INSERT INTO platform_settings (id, google_analytics_id, google_ads_id, google_ads_conversion_label, "
        "google_tag_manager_id, google_oauth_client_id, google_oauth_client_secret, seo_site_title, seo_meta_description, "
        "seo_keywords, seo_og_image_url, updated_at) VALUES ('1', '', '', '', '', '', '', 'SSHCONTROL', NULL, '', '', CURRENT_TIMESTAMP)"
    ))


def downgrade() -> None:
    op.drop_table("platform_settings")
