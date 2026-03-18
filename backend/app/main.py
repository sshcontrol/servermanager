import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import api_router
from app.config import get_settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
settings = get_settings()


def run_migrations():
    """Run Alembic migrations via subprocess to avoid deadlocks with the async event loop."""
    import subprocess
    backend_root = Path(__file__).resolve().parent.parent
    alembic_ini = backend_root / "alembic.ini"
    if not alembic_ini.is_file():
        backend_root = Path.cwd()
        alembic_ini = backend_root / "alembic.ini"
    if not alembic_ini.is_file():
        raise FileNotFoundError(
            f"alembic.ini not found. Looked at {alembic_ini}. "
            "Run from the backend directory or set PYTHONPATH so app is importable from backend."
        )
    sync_url = settings.database_url.replace("postgresql+asyncpg", "postgresql")
    env = {**os.environ, "DATABASE_URL": sync_url}
    result = subprocess.run(
        ["alembic", "-c", str(alembic_ini), "upgrade", "head"],
        cwd=str(backend_root),
        capture_output=True,
        text=True,
        timeout=60,
        env=env,
    )
    if result.returncode != 0:
        logger.error("Alembic migration failed (exit %d):\n%s\n%s", result.returncode, result.stdout, result.stderr)
        raise RuntimeError(f"Alembic migration failed with exit code {result.returncode}")
    logger.info("Alembic migrations applied.")


def _redact_url(url: str) -> str:
    """Redact password in database URL for logging."""
    if "@" in url and "://" in url:
        try:
            pre, rest = url.split("@", 1)
            if ":" in pre:
                scheme_user = pre.rsplit(":", 1)[0]
                return f"{scheme_user}:****@{rest}"
        except Exception:
            pass
    return "****"


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Backend starting. Database: %s", _redact_url(settings.database_url))
    try:
        logger.info("Running migrations...")
        run_migrations()
        logger.info("Migrations OK.")
    except Exception as e:
        logger.exception("Failed to run migrations: %s", e)
        logger.warning("App will start despite migration failure. Ensure DB schema is up to date.")
    yield
    # Shutdown: close persistent SMPP connection
    try:
        from app.services.smpp_connection import SMPPConnectionManager
        SMPPConnectionManager().shutdown()
    except Exception as e:
        logger.debug("SMPP shutdown: %s", e)


async def http_exception_handler(request: Request, exc: HTTPException):
    """Return proper status code and detail for HTTPException (e.g. 401, 404)."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )


async def global_exception_handler(request: Request, exc: Exception):
    """Log the full traceback server-side but never expose it to clients."""
    logger.exception("Unhandled exception: %s", exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal Server Error"},
    )


app = FastAPI(
    title="SSHCONTROL",
    description="Server management with JWT auth, RBAC, TOTP 2FA, and SSH key access",
    version="6.0.0",
    lifespan=lifespan,
)
# Register HTTPException first so 401/404 etc. return correct status; generic handler only for real 500s
app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(Exception, global_exception_handler)

_cors_origins = os.environ.get("CORS_ORIGINS", "").strip()
if _cors_origins:
    _allowed_origins = [o.strip() for o in _cors_origins.split(",") if o.strip()]
    _allow_origin_regex = None
else:
    _allowed_origins = [
        "https://sshcontrol.com",
        "https://www.sshcontrol.com",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost",
        "http://127.0.0.1",
    ]
    # Allow localhost/127.0.0.1 with any port, and common LAN IPs (192.168.x.x, 10.x.x.x)
    _allow_origin_regex = r"^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?$|^https?://(192\.168\.|10\.)(\d{1,3}\.){2}\d{1,3}(:[0-9]+)?$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_origin_regex=_allow_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

app.include_router(api_router)


@app.get("/health")
def health():
    return {"status": "ok"}
