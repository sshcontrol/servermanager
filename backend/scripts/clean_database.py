"""
Clean the database: remove all users (except platform superadmin), servers, tenants, and related data.

Platform superadmin = user with is_superuser=True AND tenant_id IS NULL (e.g. username 'superadmin').

Usage:
  cd backend
  python -m scripts.clean_database [--confirm]

  Without --confirm, prints what would be deleted without making changes.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError

from app.database import SessionLocal


def main():
    parser = argparse.ArgumentParser(description="Clean database, keep platform superadmin only")
    parser.add_argument("--confirm", action="store_true", help="Actually perform the cleanup (default: dry run)")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        # Check schema exists
        try:
            db.execute(text("SELECT 1 FROM users LIMIT 1"))
        except ProgrammingError as e:
            err = str(getattr(e, "orig", e))
            if "does not exist" in err or "relation" in err.lower():
                print("Database schema not found. Run migrations first: alembic upgrade head")
                sys.exit(1)
            raise

        # Count what we have
        def count(table: str, where: str = "") -> int:
            q = f"SELECT COUNT(*) FROM {table}" + (f" WHERE {where}" if where else "")
            r = db.execute(text(q)).scalar()
            return r or 0

        superadmin_count = count("users", "is_superuser = true AND tenant_id IS NULL")
        other_users = count("users", "tenant_id IS NOT NULL OR (tenant_id IS NULL AND is_superuser = false)")
        servers_count = count("servers")
        tenants_count = count("tenants")
        server_groups_count = count("server_groups")
        user_groups_count = count("user_groups")

        print("Current state:")
        print(f"  Platform superadmins (will keep): {superadmin_count}")
        print(f"  Other users (will delete):       {other_users}")
        print(f"  Servers (will delete):           {servers_count}")
        print(f"  Tenants (will delete):           {tenants_count}")
        print(f"  Server groups (will delete):    {server_groups_count}")
        print(f"  User groups (will delete):       {user_groups_count}")

        if not args.confirm:
            print("\nDry run. Add --confirm to perform the cleanup.")
            return

        print("\nCleaning...")

        # Order matters for FK constraints
        # 1. Servers (cascades: server_access, server_session_reports, server_group_servers, server_user_group_access)
        db.execute(text("DELETE FROM servers"))
        print("  Deleted servers")

        # 2. Server groups (cascades: server_group_servers, server_group_access)
        db.execute(text("DELETE FROM server_groups"))
        print("  Deleted server groups")

        # 3. User groups (cascades: user_group_members, server_user_group_access)
        db.execute(text("DELETE FROM user_groups"))
        print("  Deleted user groups")

        # 4. Tenants (cascades: users with tenant_id, subscriptions, deployment_tokens, user_invitations, etc.)
        db.execute(text("DELETE FROM tenants"))
        print("  Deleted tenants")

        # 5. Delete any remaining users that are NOT platform superadmin
        db.execute(text(
            "DELETE FROM users WHERE tenant_id IS NOT NULL OR (tenant_id IS NULL AND is_superuser = false)"
        ))
        print("  Deleted non-superadmin users")

        # 6. Clean up orphaned tokens and logs
        for table in ["destructive_verification_tokens", "email_verification_tokens", "password_reset_tokens"]:
            try:
                db.execute(text(f"DELETE FROM {table}"))
                print(f"  Cleared {table}")
            except ProgrammingError:
                pass  # Table might not exist in older migrations

        db.commit()
        print("\nDone. Database cleaned. Platform superadmin preserved.")
        print("Login with: superadmin / superadmin (or your superadmin credentials)")

    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
