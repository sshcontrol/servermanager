from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from alembic import context

from app.config import get_settings
from app.database import Base
# Import ALL models so Alembic autogenerate detects schema changes for every table
from app.models import (  # noqa: F401
    User, Role, Permission, user_roles, role_permissions,
    UserSSHKey, PlatformSSHKey,
    Server, ServerAccess, ServerSessionReport,
    ServerGroup, ServerGroupAccess, server_group_servers,
    UserGroup, ServerUserGroupAccess, user_group_members,
    DeploymentToken, AuditLog,
    IpWhitelistSettings, IpWhitelistEntry,
)

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

settings = get_settings()
sync_url = settings.database_url.replace("postgresql+asyncpg", "postgresql")
config.set_main_option("sqlalchemy.url", sync_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = context.config.attributes.get("connection", None)
    if connectable is None:
        from sqlalchemy import create_engine
        connectable = create_engine(
            config.get_main_option("sqlalchemy.url"),
            poolclass=pool.NullPool,
        )

    with connectable.connect() as connection:
        do_run_migrations(connection)


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
