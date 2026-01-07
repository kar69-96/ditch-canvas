#!/bin/bash
# Clean Vercel deployment script for ditch-canvas

set -e

echo "🚀 Starting Vercel deployment for ditch-canvas..."

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

echo "✅ Vercel CLI authenticated"

# Check if project is linked
if [ ! -f ".vercel/project.json" ]; then
    echo "🔗 Linking project to Vercel..."
    vercel link --yes --project=ditch-canvas --scope=kar69-96s-projects
fi

# Check root directory setting
ROOT_DIR=$(cat .vercel/project.json 2>/dev/null | grep -o '"rootDirectory":"[^"]*"' | cut -d'"' -f4 || echo "")

if [ "$ROOT_DIR" = "backend" ] || [ -n "$ROOT_DIR" ]; then
    echo "⚠️  WARNING: Root directory is set to '$ROOT_DIR'"
    echo ""
    echo "   The Vercel project has rootDirectory set to '$ROOT_DIR' which doesn't exist."
    echo "   This needs to be updated in the Vercel dashboard:"
    echo ""
    echo "   1. Go to: https://vercel.com/kar69-96s-projects/ditch-canvas/settings"
    echo "   2. Under 'General' > 'Root Directory', clear the value (set to empty)"
    echo "   3. Save the changes"
    echo ""
    echo "   Then run this script again."
    echo ""
    read -p "   Have you updated the root directory setting? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Please update the root directory setting first."
        exit 1
    fi
fi

# Build frontend
echo "📦 Building frontend..."
cd frontend
if [ ! -d "node_modules" ]; then
    echo "   Installing frontend dependencies..."
    npm install
fi
npm run build
cd ..

# Deploy
echo "📤 Deploying to production..."
vercel --prod --yes

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📝 Don't forget to set environment variables in Vercel dashboard:"
echo "   - SUPABASE_URL"
echo "   - SUPABASE_SERVICE_KEY"
echo "   - CLIENT_ORIGIN (optional)"

