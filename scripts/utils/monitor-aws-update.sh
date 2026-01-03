#!/bin/bash

# Monitor AWS Update Progress
echo "🔍 Monitoring AWS Update Progress"
echo "=================================="
echo ""

# Check if update is running
PID=$(ps aux | grep "run-aws-update.js" | grep -v grep | awk '{print $2}')

if [ -z "$PID" ]; then
    echo "❌ No AWS update process running"
    echo ""
    echo "Last update check:"
    COOKIE_TIME=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" ~/canvas-wrapper-data/auth/canvas-cookies.json 2>/dev/null)
    if [ -n "$COOKIE_TIME" ]; then
        echo "   Cookies last updated: $COOKIE_TIME"
    fi
    exit 0
fi

echo "✅ AWS update is currently running"
echo "   Process ID: $PID"
echo ""

# Calculate runtime
START_TIME=$(ps -p $PID -o lstart= | xargs -I{} date -j -f "%a %b %d %T %Y" "{}" "+%s" 2>/dev/null)
CURRENT_TIME=$(date +%s)
RUNTIME=$((CURRENT_TIME - START_TIME))
MINUTES=$((RUNTIME / 60))
SECONDS=$((RUNTIME % 60))

echo "   Running for: ${MINUTES}m ${SECONDS}s"
echo "   Expected total time: 4-8 minutes"
echo ""

# Estimate completion
if [ $RUNTIME -lt 240 ]; then
    echo "⏳ Status: Starting up and syncing..."
    REMAINING=$((240 - RUNTIME))
    REM_MIN=$((REMAINING / 60))
    echo "   Estimated completion: ~${REM_MIN} minutes remaining"
elif [ $RUNTIME -lt 480 ]; then
    echo "⏳ Status: Running update checks..."
    REMAINING=$((480 - RUNTIME))
    REM_MIN=$((REMAINING / 60))
    echo "   Should complete in: 0-${REM_MIN} minutes"
else
    echo "⚠️  Status: Taking longer than expected (${MINUTES}+ minutes)"
    echo "   This may indicate an issue"
fi

echo ""
echo "=================================="
echo ""
echo "Monitor in real-time:"
echo "   tail -f streaming.log | grep -i aws"
echo ""
echo "Or re-run this script to check progress:"
echo "   ./monitor-aws-update.sh"




