#!/bin/bash

# Test AWS Update Integration
# This script helps verify that the AWS update integration is working correctly

echo "🔍 Testing AWS Update Integration"
echo "=================================="
echo ""

# Check if backend server is running
echo "1. Checking if backend server is running..."
if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "   ✅ Backend server is running"
else
    echo "   ❌ Backend server is not running"
    echo "   Please start the server: cd backend && npm start"
    exit 1
fi
echo ""

# Check AWS update status
echo "2. Checking AWS update configuration..."
STATUS=$(curl -s http://localhost:3000/api/streaming-auth/update-status)
echo "   Response: $STATUS"
echo ""

# Parse status
AWS_CONFIGURED=$(echo $STATUS | grep -o '"awsConfigured":[^,]*' | cut -d: -f2)
SCRIPT_EXISTS=$(echo $STATUS | grep -o '"scriptExists":[^,]*' | cut -d: -f2)
COOKIES_EXIST=$(echo $STATUS | grep -o '"cookiesExist":[^,]*' | cut -d: -f2)
READY=$(echo $STATUS | grep -o '"ready":[^,]*' | cut -d: -f2)

if [ "$AWS_CONFIGURED" = "true" ]; then
    echo "   ✅ AWS_INSTANCE_ID is configured"
else
    echo "   ❌ AWS_INSTANCE_ID is not configured"
    echo "   Add AWS_INSTANCE_ID to your .env file"
fi

if [ "$SCRIPT_EXISTS" = "true" ]; then
    echo "   ✅ AWS update script exists"
else
    echo "   ❌ AWS update script not found"
fi

if [ "$COOKIES_EXIST" = "true" ]; then
    echo "   ✅ Cookie file exists"
else
    echo "   ⚠️  Cookie file not found (login required)"
fi

echo ""

if [ "$READY" = "true" ]; then
    echo "3. System is ready for AWS updates ✅"
    echo ""
    echo "Do you want to trigger a test update? (y/n)"
    read -r response
    
    if [ "$response" = "y" ] || [ "$response" = "Y" ]; then
        echo ""
        echo "🚀 Triggering AWS update..."
        RESULT=$(curl -s -X POST http://localhost:3000/api/streaming-auth/trigger-update)
        echo "   Response: $RESULT"
        echo ""
        echo "Check backend logs to see the update progress:"
        echo "   Look for [aws-update] messages in your terminal"
    else
        echo "   Skipping test update"
    fi
else
    echo "3. System is NOT ready for AWS updates ❌"
    echo ""
    echo "Please fix the issues above before proceeding."
fi

echo ""
echo "=================================="
echo "Test complete!"




