#!/bin/bash

# Vercel Deployment Script for ditch-canvas
set -e

echo "🚀 Deploying ditch-canvas to Vercel..."

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI is not installed. Install it with: npm i -g vercel"
    exit 1
fi

# Check if logged in
if ! vercel whoami &> /dev/null; then
    echo "❌ Not logged into Vercel. Please run: vercel login"
    exit 1
fi

echo "✅ Vercel CLI is authenticated"

# Build frontend first
echo "📦 Building frontend..."
cd frontend
npm install
npm run build
cd ..

# Check if project is linked
if [ ! -d ".vercel" ]; then
    echo "🔗 Linking project to Vercel..."
    vercel link --yes --project=ditch-canvas --scope=kar69-96s-projects
fi

echo "📤 Deploying to production..."
vercel --prod --yes

echo "✅ Deployment complete!"
echo ""
echo "📝 Next steps:"
echo "1. Make sure Root Directory is cleared in Vercel settings:"
echo "   https://vercel.com/kar69-96s-projects/ditch-canvas/settings"
echo "2. Set environment variables:"
echo "   - SUPABASE_URL"
echo "   - SUPABASE_SERVICE_KEY"
echo "   - CLIENT_ORIGIN (optional)"

