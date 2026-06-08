#!/usr/bin/env bash
# ============================================
# Silverstar Grow — Initialize local Postgres DB
# Usage:  bash scripts/init-db.sh
# Requires: psql in PATH, postgres user access
# ============================================
set -euo pipefail

DB_NAME="${DB_NAME:-silverstar_grow}"
DB_USER="${DB_USER:-postgres}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5433}"

echo "==> Creating database $DB_NAME (if not exists)"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" \
  | grep -q 1 || psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -c "CREATE DATABASE $DB_NAME;"

echo "==> Loading schema.sql"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f sql/schema.sql

echo "==> Loading seed-data.sql"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f sql/seed-data.sql

echo "==> Loading phase2-schema.sql"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f sql/phase2-schema.sql

echo "==> Loading phase3-schema.sql"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f sql/phase3-schema.sql

echo "==> Done. Database $DB_NAME is ready."
