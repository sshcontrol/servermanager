import os
from pydantic_settings import BaseSettings
from pydantic import field_validator
from functools import lru_cache


class Settings(BaseSettings):
    # Database (in Docker, set DATABASE_URL or POSTGRES_* env vars)
    database_url: str = "postgresql://servermanager:servermanager@localhost:5432/servermanager"

    # JWT — SECRET_KEY must be set via environment or .env; no default to prevent insecure deployments
    secret_key: str = ""

    @field_validator("secret_key", mode="after")
    @classmethod
    def check_secret_key(cls, v: str) -> str:
        insecure = {"", "change-me-in-production", "your-super-secret-key-change-in-production"}
        if v.strip() in insecure:
            raise ValueError(
                "SECRET_KEY is not set or uses an insecure default. "
                "Set a strong random SECRET_KEY in your .env or environment."
            )
        return v
    jwt_algorithm: str = "HS256"
    jwt_access_expire_minutes: int = 30
    jwt_refresh_expire_days: int = 7

    # TOTP
    totp_issuer: str = "SSHCONTROL"

    # Public API URL (for deploy script)
    public_api_url: str = "https://sshcontrol.com"

    # When False, skip immediate SSH sync (backend in Docker often cannot SSH to targets).
    enable_ssh_sync: bool = False

    # SendGrid email (fallback; primary config stored in DB via superadmin panel)
    sendgrid_api_key: str = ""
    sendgrid_from_email: str = "noreply@sshcontrol.com"
    sendgrid_from_name: str = "SSHCONTROL"

    # Frontend URL for email links (verify, reset password)
    frontend_url: str = "http://localhost:3000"

    @field_validator("database_url", mode="before")
    @classmethod
    def build_database_url(cls, v: str) -> str:
        # In Docker, compose usually sets DATABASE_URL. If it's still localhost default and POSTGRES_* or PGHOST is set, build URL (e.g. .env not mounted in container).
        default_local = "postgresql://servermanager:servermanager@localhost:5432/servermanager"
        if v and v != default_local:
            return v
        if not (os.environ.get("POSTGRES_USER") or os.environ.get("PGHOST")):
            return v or default_local
        user = os.environ.get("POSTGRES_USER", "servermanager")
        password = os.environ.get("POSTGRES_PASSWORD", "servermanager")
        dbname = os.environ.get("POSTGRES_DB", "servermanager")
        host = os.environ.get("PGHOST", "db")
        port = os.environ.get("PGPORT", "5432")
        return f"postgresql://{user}:{password}@{host}:{port}/{dbname}"

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


@lru_cache
def get_settings() -> Settings:
    return Settings()
