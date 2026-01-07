#!/bin/bash
# Script to fix Vercel root directory via API

set -e

PROJECT_ID="prj_cvxCpUSeAm9XvUHkfsVhLDFZ4e0l"
TEAM_ID="team_KF1zgAuYxiRx0Li51iMZtaVg"

echo "🔍 Getting Vercel authentication token..."

# Try to get token from environment or Vercel CLI config
TOKEN="${VERCEL_TOKEN:-}"

if [ -z "$TOKEN" ]; then
    # Try reading from Vercel config if it exists
    if [ -f ~/.vercel/auth.json ]; then
        TOKEN=$(cat ~/.vercel/auth.json | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)
    fi
fi

if [ -z "$TOKEN" ]; then
    echo "❌ Could not find Vercel token."
    echo "   Please set VERCEL_TOKEN environment variable or update manually:"
    echo "   https://vercel.com/kar69-96s-projects/ditch-canvas/settings"
    exit 1
fi

echo "✅ Token found, updating project settings..."

# Update root directory via API
RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH \
  "https://api.vercel.com/v9/projects/${PROJECT_ID}?teamId=${TEAM_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"rootDirectory":null}')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Successfully updated root directory!"
    echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
else
    echo "❌ Failed to update (HTTP $HTTP_CODE):"
    echo "$BODY"
    exit 1
fi

