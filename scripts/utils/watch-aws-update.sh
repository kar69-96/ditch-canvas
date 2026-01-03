#!/bin/bash

# Watch AWS Update via CloudWatch Logs
# This script streams CloudWatch logs in real-time

echo "🔍 AWS Update CloudWatch Logs Monitor"
echo "======================================"
echo ""

# Check if AWS CLI is available
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI not found"
    echo "   Install: https://aws.amazon.com/cli/"
    exit 1
fi

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found"
    exit 1
fi

# Navigate to scripts/aws directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT/scripts/aws" || exit 1

# Check if stream name provided
if [ -z "$1" ]; then
    echo "📋 Listing recent log streams..."
    echo ""
    node tail-cloudwatch-logs.js
    echo ""
    echo "Usage: ./watch-aws-update.sh [stream-name]"
    echo "Example: ./watch-aws-update.sh 2025-12-24T19-12-00"
    exit 0
fi

STREAM_NAME="$1"

echo "📡 Streaming CloudWatch logs for: $STREAM_NAME"
echo "   (Press Ctrl+C to stop)"
echo ""
echo "======================================"
echo ""

# Stream logs
node tail-cloudwatch-logs.js "$STREAM_NAME"




