#!/bin/bash
# Push migration using Supabase CLI with access token

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Pushing Migration via Supabase CLI"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd "$(dirname "$0")/.."

# Check if access token is provided
if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
  echo "⚠️  SUPABASE_ACCESS_TOKEN not set"
  echo ""
  echo "To use Supabase CLI, you need a personal access token:"
  echo "  1. Go to: https://supabase.com/dashboard/account/tokens"
  echo "  2. Create a new access token"
  echo "  3. Set it: export SUPABASE_ACCESS_TOKEN=your_token"
  echo "  4. Run this script again"
  echo ""
  echo "Or use the SQL Editor method (see QUICK_FIX_USERS_TABLE.md)"
  exit 1
fi

echo "✅ Using access token for authentication"
echo ""

# Link project
echo "🔗 Linking to project..."
supabase link --project-ref hwmoglxyhkecxanxdzfm 2>&1 | grep -v "already linked" || true
echo ""

# Push migrations
echo "📦 Pushing migrations..."
supabase db push --include-all

echo ""
echo "✅ Done!"
