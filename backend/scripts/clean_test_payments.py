"""
Clean test payment history from payment_transactions.

Use this when you switched from Stripe test mode to production and want to remove
old test payment records. Payment history is display-only; deleting it does NOT
affect subscriptions, plans, or tenant access.

Usage:
  cd backend
  python -m scripts.clean_test_payments [--before YYYY-MM-DD] [--all] [--confirm]

  --before YYYY-MM-DD  Delete only payments created before this date (e.g. --before 2025-02-22)
  --all                Delete ALL payment transactions
  --confirm            Actually perform the delete (default: dry run only)

Examples:
  # Dry run: see what would be deleted (no changes)
  python -m scripts.clean_test_payments --all

  # Delete all test payments created before you went live
  python -m scripts.clean_test_payments --before 2025-02-22 --confirm

  # Delete all payment history
  python -m scripts.clean_test_payments --all --confirm
"""
import argparse
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError

from app.database import SessionLocal


def main():
    parser = argparse.ArgumentParser(
        description="Clean test payment history from payment_transactions"
    )
    parser.add_argument(
        "--before",
        metavar="YYYY-MM-DD",
        help="Delete only payments created before this date (e.g. 2025-02-22)",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Delete ALL payment transactions",
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Actually perform the delete (default: dry run)",
    )
    args = parser.parse_args()

    if not args.before and not args.all:
        parser.error("Specify either --before YYYY-MM-DD or --all")

    if args.before:
        try:
            cutoff = datetime.strptime(args.before, "%Y-%m-%d")
        except ValueError:
            parser.error(f"Invalid date format: {args.before}. Use YYYY-MM-DD")
            return
    else:
        cutoff = None

    db = SessionLocal()
    try:
        # Check table exists
        try:
            r = db.execute(text("SELECT COUNT(*) FROM payment_transactions"))
            total = r.scalar() or 0
        except ProgrammingError as e:
            err = str(getattr(e, "orig", e))
            if "does not exist" in err or "relation" in err.lower():
                print("payment_transactions table not found. Run migrations first: alembic upgrade head")
                sys.exit(1)
            raise

        if total == 0:
            print("No payment transactions in database. Nothing to clean.")
            return

        # Build filter and count
        if args.all:
            where_clause = ""
            params = {}
            to_delete = total
        else:
            where_clause = "WHERE created_at < :cutoff"
            params = {"cutoff": cutoff}
            r = db.execute(
                text(f"SELECT COUNT(*) FROM payment_transactions {where_clause}"),
                params,
            )
            to_delete = r.scalar() or 0

        # Summary: sum of amounts to be deleted
        sum_sql = f"SELECT COALESCE(SUM(amount), 0) as total, MAX(currency) as currency FROM payment_transactions {where_clause}"
        sum_result = db.execute(text(sum_sql), params).fetchone()
        sum_amount = float(sum_result[0]) if sum_result and sum_result[0] else 0
        currency = sum_result[1] if sum_result and sum_result[1] else "USD"

        print("Payment transactions:")
        print(f"  Total in database:  {total}")
        print(f"  To be deleted:      {to_delete}")
        if to_delete > 0:
            print(f"  Total amount:       {sum_amount:.2f} {currency}")

        if to_delete == 0:
            print("\nNo records match the criteria. Nothing to delete.")
            return

        if not args.confirm:
            print("\nDry run. Add --confirm to actually delete these records.")
            return

        # Delete
        delete_sql = f"DELETE FROM payment_transactions {where_clause}"
        db.execute(text(delete_sql), params)
        db.commit()
        print(f"\nDeleted {to_delete} payment transaction(s).")
        print("Subscriptions and tenant access are unchanged.")

    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
