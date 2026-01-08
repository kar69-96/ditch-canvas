#!/bin/bash

# Real-time CloudWatch Logs Monitor using AWS CLI
# This script tails CloudWatch logs in real-time

LOG_GROUP="/aws/canvas-wrapper/updates"
REGION="us-east-1"

echo "🔍 CloudWatch Logs Monitor (AWS CLI)"
echo "===================================="
echo "   Log Group: $LOG_GROUP"
echo "   Region: $REGION"
echo ""

# Check if log group exists
if ! aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" --region "$REGION" 2>&1 | grep -q "$LOG_GROUP"; then
    echo "⏳ Log group doesn't exist yet. Waiting for it to be created..."
    echo "   (This happens when the update script starts)"
    echo ""
    
    # Wait for log group
    for i in {1..30}; do
        if aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" --region "$REGION" 2>&1 | grep -q "$LOG_GROUP"; then
            echo "✅ Log group created!"
            break
        fi
        echo -n "."
        sleep 2
    done
    echo ""
fi

# Get most recent log stream
echo "📋 Finding most recent log stream..."
STREAM_NAME=$(aws logs describe-log-streams \
    --log-group-name "$LOG_GROUP" \
    --order-by LastEventTime \
    --descending \
    --max-items 1 \
    --region "$REGION" \
    2>&1 | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    streams = data.get('logStreams', [])
    if streams:
        print(streams[0]['logStreamName'])
    else:
        print('')
except:
    print('')
" 2>/dev/null)

if [ -z "$STREAM_NAME" ]; then
    echo "⚠️  No log streams found yet"
    echo ""
    echo "The update script may still be starting up."
    echo "Log streams are created when the script begins logging."
    echo ""
    echo "Waiting for first log stream..."
    
    # Poll for stream creation
    for i in {1..60}; do
        STREAM_NAME=$(aws logs describe-log-streams \
            --log-group-name "$LOG_GROUP" \
            --order-by LastEventTime \
            --descending \
            --max-items 1 \
            --region "$REGION" \
            2>&1 | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    streams = data.get('logStreams', [])
    if streams:
        print(streams[0]['logStreamName'])
    else:
        print('')
except:
    print('')
" 2>/dev/null)
        
        if [ -n "$STREAM_NAME" ]; then
            echo "✅ Found log stream: $STREAM_NAME"
            break
        fi
        echo -n "."
        sleep 2
    done
    echo ""
fi

if [ -z "$STREAM_NAME" ]; then
    echo "❌ No log stream found after waiting"
    echo ""
    echo "Possible reasons:"
    echo "  1. Update script hasn't started yet"
    echo "  2. CloudWatch logging is disabled"
    echo "  3. AWS credentials/permissions issue"
    exit 1
fi

echo "📡 Streaming logs from: $STREAM_NAME"
echo "   (Press Ctrl+C to stop)"
echo ""
echo "===================================="
echo ""

# Calculate start time (1 minute ago)
START_TIME=$(($(date +%s) * 1000 - 60000))

# Stream logs using AWS CLI
aws logs tail "$LOG_GROUP" \
    --log-stream-names "$STREAM_NAME" \
    --since "${START_TIME}ms" \
    --follow \
    --format short \
    --region "$REGION" 2>&1




