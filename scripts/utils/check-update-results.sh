#!/bin/bash

# Check AWS Update Results
# This script checks the most recent AWS update run and reports results

echo "🔍 Checking AWS Update Results"
echo "==============================="
echo ""

# Check if extraction summary exists
EXTRACTION_SUMMARY="working/extraction-summary.json"
if [ -f "$EXTRACTION_SUMMARY" ]; then
    echo "📊 Extraction Summary:"
    LAST_MODIFIED=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$EXTRACTION_SUMMARY" 2>/dev/null || stat -c "%y" "$EXTRACTION_SUMMARY" 2>/dev/null | cut -d' ' -f1-2)
    echo "   Last updated: $LAST_MODIFIED"
    
    # Extract folder name
    EXTRACTION_FOLDER=$(grep -o '"extractionFolder": "[^"]*"' "$EXTRACTION_SUMMARY" | cut -d'"' -f4)
    if [ -n "$EXTRACTION_FOLDER" ]; then
        echo "   Extraction folder: $EXTRACTION_FOLDER"
        
        # Check for update logs
        UPDATE_LOG_DIR="storage/datasets/$EXTRACTION_FOLDER/updates"
        if [ -d "$UPDATE_LOG_DIR" ]; then
            echo ""
            echo "📝 Update Logs:"
            LATEST_UPDATE=$(ls -t "$UPDATE_LOG_DIR"/*.json 2>/dev/null | head -1)
            if [ -n "$LATEST_UPDATE" ]; then
                UPDATE_TIME=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$LATEST_UPDATE" 2>/dev/null || stat -c "%y" "$LATEST_UPDATE" 2>/dev/null | cut -d' ' -f1-2)
                echo "   Latest update log: $UPDATE_TIME"
                echo "   File: $LATEST_UPDATE"
                
                # Extract key info from update log
                if command -v python3 &> /dev/null; then
                    echo ""
                    echo "📋 Update Summary:"
                    python3 << EOF
import json
import sys

try:
    with open("$LATEST_UPDATE", 'r') as f:
        data = json.load(f)
    
    print(f"   Courses scanned: {data.get('totalCoursesScanned', 'N/A')}")
    print(f"   Courses with updates: {data.get('coursesWithUpdates', 'N/A')}")
    print(f"   Changes applied: {data.get('changesApplied', 'N/A')}")
    print(f"   Dry run: {data.get('dryRun', 'N/A')}")
    
    if data.get('courses'):
        print(f"\n   Courses with changes:")
        for course in data['courses'][:5]:
            print(f"      - {course.get('courseName', 'Unknown')} (ID: {course.get('courseId', 'N/A')})")
            if len(data['courses']) > 5:
                print(f"      ... and {len(data['courses']) - 5} more")
except Exception as e:
    print(f"   Error reading update log: {e}")
EOF
                fi
            else
                echo "   No update logs found"
            fi
        else
            echo ""
            echo "⚠️  No update logs directory found"
        fi
    fi
else
    echo "❌ Extraction summary not found"
fi

echo ""
echo "==============================="
echo ""
echo "💡 To check CloudWatch logs:"
echo "   ./watch-aws-update.sh"
echo ""
echo "💡 To check backend server logs:"
echo "   Look at your backend terminal for [aws-update] messages"




