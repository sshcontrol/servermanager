from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import sessionmaker, declarative_base
from app.config import get_settings

settings = get_settings()

# Sync engine for Alembic migrations
SYNC_DATABASE_URL = settings.database_url.replace("postgresql+asyncpg", "postgresql")
engine = create_engine(SYNC_DATABASE_URL, pool_pre_ping=True)

# Async engine for FastAPI
ASYNC_DATABASE_URL = settings.database_url
if not ASYNC_DATABASE_URL.startswith("postgresql+asyncpg"):
    ASYNC_DATABASE_URL = settings.database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
async_engine = create_async_engine(ASYNC_DATABASE_URL, echo=False, pool_pre_ping=True)

AsyncSessionLocal = async_sessionmaker(
    async_engine, class_=AsyncSession, expire_on_commit=False, autocommit=False, autoflush=False
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db_sync():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
