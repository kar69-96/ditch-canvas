#!/bin/bash
# Update Vercel project root directory via API
# Usage: VERCEL_TOKEN=your_token ./update-root-directory.sh
# Or get token from: https://vercel.com/account/tokens

set -e

PROJECT_ID="prj_cvxCpUSeAm9XvUHkfsVhLDFZ4e0l"
TEAM_ID="team_KF1zgAuYxiRx0Li51iMZtaVg"

if [ -z "$VERCEL_TOKEN" ]; then
    echo "❌ VERCEL_TOKEN environment variable is required"
    echo ""
    echo "To get a token:"
    echo "1. Go to https://vercel.com/account/tokens"
    echo "2. Create a new token"
    echo "3. Run: VERCEL_TOKEN=your_token ./update-root-directory.sh"
    exit 1
fi

echo "🔄 Updating Vercel project root directory..."

RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH \
  "https://api.vercel.com/v9/projects/${PROJECT_ID}?teamId=${TEAM_ID}" \
  -H "Authorization: Bearer ${VERCEL_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"rootDirectory":null}')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Successfully cleared root directory!"
    echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
else
    echo "❌ Failed to update (HTTP $HTTP_CODE):"
    echo "$BODY"
    exit 1
fi

