#!/bin/bash

# Apply Supabase migration using psql
# This script reads credentials from .env.local and applies the migration

set -e

echo "🚀 Starting migration application..."
echo ""

# Load environment variables
if [ -f .env.local ]; then
  source <(grep -v '^#' .env.local | sed 's/^/export /')
  echo "✅ Loaded environment variables from .env.local"
else
  echo "❌ .env.local file not found"
  exit 1
fi

# Check for required variables
if [ -z "$SUPABASE_PROJECT_REF" ]; then
  echo "❌ SUPABASE_PROJECT_REF not found in .env.local"
  exit 1
fi

if [ -z "$SUPABASE_DB_PASSWORD" ]; then
  echo "❌ SUPABASE_DB_PASSWORD not found in .env.local"
  exit 1
fi

# Migration file path
MIGRATION_FILE="supabase/migrations/20260109110000_complete_migration_with_demo_user.sql"

if [ ! -f "$MIGRATION_FILE" ]; then
  echo "❌ Migration file not found: $MIGRATION_FILE"
  exit 1
fi

echo "📄 Migration file: $MIGRATION_FILE"
echo ""

# Connection details (from config.toml and env)
PROJECT_REF="$SUPABASE_PROJECT_REF"
DB_HOST="aws-0-us-west-2.pooler.supabase.com"
DB_PORT="6543"
DB_USER="postgres.${PROJECT_REF}"
DB_NAME="postgres"

# Build connection string
export PGPASSWORD="$SUPABASE_DB_PASSWORD"

echo "⏳ Connecting to Supabase database..."
echo "   Host: $DB_HOST"
echo "   User: $DB_USER"
echo ""

# Apply the migration using psql
echo "📊 Applying migration..."
echo ""

if command -v psql &> /dev/null; then
  psql "postgresql://${DB_USER}:${SUPABASE_DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}" \
    -f "$MIGRATION_FILE" \
    --echo-errors \
    2>&1 | tee migration-output.log

  if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo ""
    echo "✅ Migration applied successfully!"
    echo ""

    # Verify the migration
    echo "🔍 Verifying migration..."
    echo ""

    psql "postgresql://${DB_USER}:${SUPABASE_DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}" \
      -c "SELECT email, first_name, student, school FROM users LIMIT 5;" \
      2>&1

    echo ""
    echo "🔍 Checking demo user..."
    echo ""

    psql "postgresql://${DB_USER}:${SUPABASE_DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}" \
      -c "SELECT email, first_name, student, school, last_login_at, onboarding_completed_at FROM users WHERE email = 'kare6625@colorado.edu';" \
      2>&1

    echo ""
    echo "🎉 Migration complete!"
    echo ""
    echo "Next steps:"
    echo "  1. Test login with kare6625@colorado.edu"
    echo "  2. Verify dashboard shows 'Hi, kare6625'"
    echo "  3. Check that data loads correctly"
    echo ""
  else
    echo ""
    echo "❌ Migration failed. Check migration-output.log for details."
    exit 1
  fi
else
  echo "❌ psql command not found. Please install PostgreSQL client tools."
  echo ""
  echo "macOS: brew install postgresql"
  echo "Ubuntu: sudo apt-get install postgresql-client"
  exit 1
fi
