#!/bin/bash

# Comprehensive Update Results Checker
# Checks multiple sources to determine the last update status

echo "🔍 AWS Update Results Analysis"
echo "=============================="
echo ""

# 1. Check extraction summary timestamp
echo "1️⃣  Extraction Summary Status:"
EXTRACTION_SUMMARY="working/extraction-summary.json"
if [ -f "$EXTRACTION_SUMMARY" ]; then
    LAST_MODIFIED=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$EXTRACTION_SUMMARY" 2>/dev/null || stat -c "%y" "$EXTRACTION_SUMMARY" 2>/dev/null | cut -d' ' -f1-2)
    EXTRACTION_FOLDER=$(grep -o '"extractionFolder": "[^"]*"' "$EXTRACTION_SUMMARY" | cut -d'"' -f4)
    echo "   ✅ Last updated: $LAST_MODIFIED"
    echo "   📁 Folder: $EXTRACTION_FOLDER"
    
    # Calculate age
    if command -v python3 &> /dev/null; then
        AGE_HOURS=$(python3 -c "
from datetime import datetime
try:
    mod_time = datetime.strptime('$LAST_MODIFIED', '%Y-%m-%d %H:%M:%S')
    now = datetime.now()
    age = (now - mod_time).total_seconds() / 3600
    print(f'{age:.1f}')
except:
    print('unknown')
")
        echo "   ⏰ Age: ${AGE_HOURS} hours ago"
        
        if (( $(echo "$AGE_HOURS > 24" | bc -l 2>/dev/null || echo 0) )); then
            echo "   ⚠️  Summary is more than 24 hours old"
        fi
    fi
else
    echo "   ❌ Not found"
fi

echo ""

# 2. Check for running AWS update process
echo "2️⃣  Current AWS Update Status:"
RUNNING_PID=$(ps aux | grep "run-aws-update.js" | grep -v grep | awk '{print $2}')
if [ -n "$RUNNING_PID" ]; then
    START_TIME=$(ps -p "$RUNNING_PID" -o lstart= 2>/dev/null | xargs)
    echo "   🔄 Update is currently running (PID: $RUNNING_PID)"
    echo "   🕐 Started: $START_TIME"
    echo "   💡 Check backend terminal or CloudWatch for progress"
else
    echo "   ✅ No update currently running"
fi

echo ""

# 3. Check CloudWatch logs
echo "3️⃣  CloudWatch Logs:"
cd backend/aws 2>/dev/null || cd ../backend/aws 2>/dev/null || { echo "   ⚠️  Cannot access backend/aws directory"; exit 1; }
if command -v node &> /dev/null; then
    STREAMS=$(node tail-cloudwatch-logs.js 2>&1 | grep -A 20 "Recent log streams" | grep -E "^\s+[0-9]+\." | head -3)
    if [ -n "$STREAMS" ]; then
        echo "   ✅ Recent log streams found:"
        echo "$STREAMS" | while read line; do
            echo "      $line"
        done
    else
        echo "   ⚠️  No CloudWatch log streams found"
        echo "      (Update may not have run with CloudWatch enabled yet)"
    fi
else
    echo "   ⚠️  Node.js not available to check CloudWatch"
fi

echo ""

# 4. Check cookie file timestamp
echo "4️⃣  Cookie File Status:"
COOKIE_FILE="$HOME/canvas-wrapper-data/auth/canvas-cookies.json"
if [ -f "$COOKIE_FILE" ]; then
    COOKIE_TIME=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$COOKIE_FILE" 2>/dev/null || stat -c "%y" "$COOKIE_FILE" 2>/dev/null | cut -d' ' -f1-2)
    echo "   ✅ Cookies last updated: $COOKIE_TIME"
    
    if command -v python3 &> /dev/null; then
        COOKIE_AGE=$(python3 -c "
from datetime import datetime
try:
    mod_time = datetime.strptime('$COOKIE_TIME', '%Y-%m-%d %H:%M:%S')
    now = datetime.now()
    age = (now - mod_time).total_seconds() / 3600
    print(f'{age:.1f}')
except:
    print('unknown')
")
        echo "   ⏰ Age: ${COOKIE_AGE} hours ago"
    fi
else
    echo "   ⚠️  Cookie file not found at expected location"
fi

echo ""

# 5. Summary and recommendations
echo "📊 Summary:"
echo "==========="

if [ -n "$RUNNING_PID" ]; then
    echo "✅ Update is currently running - wait for completion"
    echo "   Monitor with: ./watch-aws-update.sh"
elif [ -f "$EXTRACTION_SUMMARY" ]; then
    if command -v python3 &> /dev/null && [ -n "$AGE_HOURS" ]; then
        if (( $(echo "$AGE_HOURS < 1" | bc -l 2>/dev/null || echo 0) )); then
            echo "✅ Recent update completed (less than 1 hour ago)"
            echo "   Data should be up to date in Supabase"
        elif (( $(echo "$AGE_HOURS < 24" | bc -l 2>/dev/null || echo 0) )); then
            echo "⚠️  Last update was ${AGE_HOURS} hours ago"
            echo "   If you logged in recently, update may still be running"
        else
            echo "⚠️  Last update was ${AGE_HOURS} hours ago (more than 24 hours)"
            echo "   Consider triggering a new update"
        fi
    fi
fi

echo ""
echo "💡 Next Steps:"
echo "   1. Check backend terminal for [aws-update] messages"
echo "   2. Run: ./watch-aws-update.sh (to see CloudWatch logs)"
echo "   3. Check Supabase for recent data updates"
echo "   4. Refresh browser to see latest data"




