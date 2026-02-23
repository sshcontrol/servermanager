from fastapi import APIRouter
from app.api import auth, users, roles, admin_ssh_key, admin_backup, servers, history, server_groups, user_groups, security, signup, superadmin

api_router = APIRouter(prefix="/api")

api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(roles.router, prefix="/roles", tags=["roles"])
api_router.include_router(admin_ssh_key.router)
api_router.include_router(admin_backup.router)
api_router.include_router(servers.router)
api_router.include_router(server_groups.router)
api_router.include_router(user_groups.router)
api_router.include_router(history.router)
api_router.include_router(security.router)
api_router.include_router(signup.router, prefix="/public", tags=["public"])
api_router.include_router(superadmin.router, prefix="/superadmin", tags=["superadmin"])
