#!/bin/bash

# Supabase CLI Setup Script
# This script helps you set up and push migrations to Supabase

set -e

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
echo "   Project Ref: hwmoglxyhkecxanxdzfm"
supabase link --project-ref hwmoglxyhkecxanxdzfm || {
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

