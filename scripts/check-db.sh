#!/usr/bin/env bash
# ============================================
# Silverstar Grow — Quick DB connection test
# Usage:  bash scripts/check-db.sh
# ============================================
set -euo pipefail

# Load .env if it exists
if [ -f server/.env ]; then
  set -a
  . server/.env
  set +a
fi

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5433}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-silverstar_grow}"

echo "Testing connection to: $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"

if PGPASSWORD="${DB_PASSWORD:-}" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
     -c "SELECT version();" > /dev/null 2>&1; then
  echo "✓ Connection OK"
  PGPASSWORD="${DB_PASSWORD:-}" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -c "SELECT count(*) AS user_count FROM users;"
else
  echo "✗ Connection FAILED"
  echo ""
  echo "Troubleshoot:"
  echo "  1. Is Postgres running?        systemctl status postgresql   (or) docker ps"
  echo "  2. Is the database created?    psql -U postgres -l"
  echo "  3. Password correct in .env?   cat server/.env"
  echo "  4. Host reachable?             pg_isready -h $DB_HOST -p $DB_PORT"
  exit 1
fi
