#!/bin/bash

echo "🔍 Debugging 'Load failed' Error"
echo "================================="
echo ""

# Test 1: Check if frontend loads
echo "1. Testing Frontend Load..."
FRONTEND_CODE=$(curl -s -o /dev/null -w "%{http_code}" https://ditchcanvas.com/login)
if [ "$FRONTEND_CODE" = "200" ]; then
    echo "   ✅ Frontend loads: HTTP $FRONTEND_CODE"
else
    echo "   ❌ Frontend failed: HTTP $FRONTEND_CODE"
fi

# Test 2: Check if JavaScript bundle has Supabase config
echo "2. Checking JavaScript Bundle..."
JS_URL=$(curl -s https://ditchcanvas.com/login | grep -o 'src="/assets/index-[^"]*\.js"' | sed 's/src="//;s/"//')
if [ ! -z "$JS_URL" ]; then
    echo "   Found JS: $JS_URL"
    
    # Check for Supabase URL
    if curl -s "https://ditchcanvas.com$JS_URL" | grep -q "hwmoglxyhkecxanxdzfm"; then
        echo "   ✅ Supabase URL found in bundle"
    else
        echo "   ❌ Supabase URL NOT in bundle"
    fi
    
    # Check for Supabase Anon Key
    if curl -s "https://ditchcanvas.com$JS_URL" | grep -q "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"; then
        echo "   ✅ Supabase Anon Key found in bundle"
    else
        echo "   ❌ Supabase Anon Key NOT in bundle"
    fi
fi

# Test 3: Test API Endpoints
echo "3. Testing API Endpoints..."
HEALTH=$(curl -s https://ditchcanvas.com/api/health)
if echo "$HEALTH" | grep -q "ok"; then
    echo "   ✅ /api/health works"
else
    echo "   ❌ /api/health failed"
    echo "      Response: $HEALTH"
fi

# Test 4: Test check-email endpoint
echo "4. Testing Check Email Endpoint..."
EMAIL_CHECK=$(curl -s -X POST https://ditchcanvas.com/api/streaming-auth/check-email \
    -H "Content-Type: application/json" \
    -d '{"email":"test@colorado.edu"}')
if echo "$EMAIL_CHECK" | grep -q "success"; then
    echo "   ✅ /api/streaming-auth/check-email works"
    echo "      Response: $EMAIL_CHECK"
else
    echo "   ❌ /api/streaming-auth/check-email failed"
    echo "      Response: $EMAIL_CHECK"
fi

echo ""
echo "================================="
echo "📋 Summary"
echo "================================="
echo ""
echo "If all tests pass above, the deployment is working correctly."
echo ""
echo "The 'Load failed' error could be:"
echo ""
echo "1. ❌ Browser Cache Issue"
echo "   Solution: Hard refresh the page (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows)"
echo ""
echo "2. ❌ CORS or Network Error"
echo "   Solution: Open browser DevTools (F12) → Console tab → Look for error messages"
echo ""
echo "3. ❌ Supabase Connection Error"
echo "   Solution: Check if your Supabase project is active and accessible"
echo ""
echo "4. ❌ Wrong API URL in Environment"
echo "   Current VITE_API_BASE_URL might be set wrong"
echo ""
echo "To see the actual error:"
echo "  1. Open https://ditchcanvas.com/login in your browser"
echo "  2. Press F12 to open DevTools"
echo "  3. Go to the Console tab"
echo "  4. Look for red error messages"
echo "  5. Share the error message with me"
echo ""

