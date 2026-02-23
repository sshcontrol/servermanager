"""
Create initial admin user. Run after migrations.
Usage: python -m scripts.create_admin [--username admin] [--password admin] [--email admin@localhost] [--phone +1234567890] [--force]
  --force: if user exists, reset password and ensure superuser (so you can log in again).
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select, text
from sqlalchemy.exc import ProgrammingError
from app.database import SessionLocal
from app.models import User
from app.models.association import user_roles
from app.core.security import get_password_hash


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", default=os.getenv("ADMIN_USERNAME", "admin"))
    parser.add_argument("--password", default=os.getenv("ADMIN_PASSWORD", "admin"))
    parser.add_argument("--email", default=os.getenv("ADMIN_EMAIL", "admin@localhost"))
    parser.add_argument("--phone", default=os.getenv("ADMIN_PHONE", ""), help="E.164 with country code, e.g. +1234567890")
    parser.add_argument("--force", action="store_true", help="If user exists, reset password and ensure active/superuser")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        try:
            existing = db.execute(select(User).where(User.username == args.username)).scalar_one_or_none()
        except ProgrammingError as e:
            err = str(e.orig) if getattr(e, "orig", None) else str(e)
            if "does not exist" in err or "relation" in err.lower():
                print("Database schema not found. Run migrations first:")
                print("  alembic upgrade head")
                sys.exit(1)
            raise
        if existing:
            if args.force:
                existing.hashed_password = get_password_hash(args.password)
                existing.email = args.email
                if args.phone:
                    existing.phone = args.phone
                existing.is_active = True
                existing.is_superuser = True
                db.commit()
                print(f"Admin user {args.username} updated: password and email reset. You can log in now.")
            else:
                print(f"User {args.username} already exists. Use --force to reset password.")
            return
        role_row = db.execute(text("SELECT id FROM roles WHERE name = 'admin' LIMIT 1")).fetchone()
        if not role_row:
            print("Run migrations first (alembic upgrade head).")
            return
        admin_role_id = role_row[0]
        user = User(
            id=str(__import__("uuid").uuid4()),
            email=args.email,
            username=args.username,
            phone=args.phone or None,
            hashed_password=get_password_hash(args.password),
            is_active=True,
            is_superuser=True,
        )
        db.add(user)
        db.flush()
        db.execute(user_roles.insert().values(user_id=user.id, role_id=admin_role_id))
        db.commit()
        print(f"Admin user created: {args.username}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
