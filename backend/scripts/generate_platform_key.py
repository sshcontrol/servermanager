"""
Generate the platform SSH key (required before deploying servers).
Usage: python -m scripts.generate_platform_key [--tenant-id ID] [--all-tenants]
  --tenant-id: tenant ID; omit for platform-wide (tenant_id=NULL) key.
  --all-tenants: generate for every tenant that has a deployment token.
Run from backend dir or with PYTHONPATH set. Requires DATABASE_URL.
"""
import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from app.config import get_settings
from app.models.deployment import DeploymentToken
from app.services.platform_key_service import PlatformKeyService


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tenant-id", default=None, help="Tenant ID; omit for platform-wide key")
    parser.add_argument("--all-tenants", action="store_true", help="Generate for all tenants with deployment tokens")
    args = parser.parse_args()

    settings = get_settings()
    db_url = settings.database_url
    if not db_url.startswith("postgresql+asyncpg"):
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    engine = create_async_engine(db_url)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as db:
        if args.all_tenants:
            r = await db.execute(select(DeploymentToken.tenant_id).distinct())
            tenant_ids = [row[0] for row in r.all()]
            for tid in tenant_ids:
                await PlatformKeyService.regenerate(db, tenant_id=tid)
                print(f"Platform SSH key generated for tenant {tid}")
            await PlatformKeyService.regenerate(db, tenant_id=None)
            print("Platform SSH key generated (platform-wide)")
        else:
            await PlatformKeyService.regenerate(db, tenant_id=args.tenant_id or None)
            scope = f"tenant {args.tenant_id}" if args.tenant_id else "platform-wide"
            print(f"Platform SSH key generated ({scope}). You can now deploy servers.")
        await db.commit()


if __name__ == "__main__":
    asyncio.run(main())
