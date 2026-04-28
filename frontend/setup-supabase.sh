#!/bin/bash

# Supabase CLI Setup Script
# This script helps you set up and push migrations to Supabase

set -e

# Load SUPABASE_PROJECT_REF from .env.local if present
_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_ROOT_DIR="$(cd "$_SCRIPT_DIR/.." && pwd)"
for _ENV_FILE in "$_SCRIPT_DIR/.env.local" "$_ROOT_DIR/.env.local"; do
    if [ -f "$_ENV_FILE" ]; then
        set -a
        # shellcheck disable=SC1090
        source "$_ENV_FILE"
        set +a
        break
    fi
done

echo "🚀 Supabase CLI Setup"
echo "===================="
echo ""

# Check if supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI is not installed"
    echo "   Install with: brew install supabase/tap/supabase"
    exit 1
fi

echo "✅ Supabase CLI is installed: $(supabase --version)"
echo ""

# Check if logged in
echo "📋 Checking authentication..."
if ! supabase projects list &> /dev/null; then
    echo "🔐 Please login to Supabase:"
    supabase login
else
    echo "✅ Already logged in"
fi

echo ""
echo "🔗 Linking to project..."
if [ -z "$SUPABASE_PROJECT_REF" ]; then
    echo "❌ SUPABASE_PROJECT_REF is not set."
    echo "   Export it or add it to .env.local (Supabase → Project Settings → General → Reference ID)."
    exit 1
fi
echo "   Project Ref: $SUPABASE_PROJECT_REF"
supabase link --project-ref "$SUPABASE_PROJECT_REF" || {
    echo "⚠️  Project may already be linked"
}

echo ""
echo "📦 Pushing migrations..."
echo "   This will run:"
echo "   - 001_create_users_and_sessions.sql"
echo "   - 002_create_extraction_data_tables.sql"
echo ""

read -p "Continue? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    supabase db push
    echo ""
    echo "✅ Migrations pushed!"
    echo ""
    echo "📤 Next step: Upload data"
    echo "   Run: npm run supabase:upload-data kare6625@colorado.edu sample_data"
else
    echo "⏭️  Skipped. Run 'supabase db push' when ready."
fi

