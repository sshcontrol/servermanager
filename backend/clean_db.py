#!/usr/bin/env python3
"""
Clean the database: truncate all application tables (all data removed).
Run from the backend directory:  python clean_db.py

Requires DATABASE_URL (or .env) to be set. Asks for confirmation before running.
"""
import sys

# Ensure app is importable (backend root or PYTHONPATH)
if __name__ == "__main__":
    try:
        from app.services.backup_service import clean_database
    except ImportError:
        print("Run this script from the backend directory:  cd backend && python clean_db.py")
        sys.exit(1)

    print("This will DELETE ALL DATA in the database (users, servers, groups, audit log, etc.).")
    ok = input("Type 'yes' to confirm: ").strip().lower()
    if ok != "yes":
        print("Aborted.")
        sys.exit(0)
    try:
        clean_database()
        print("Database cleaned successfully.")
    except Exception as e:
        print("Error:", e)
        sys.exit(1)
