#!/bin/bash

echo "🧪 Testing Vercel Deployment"
echo "================================"
echo ""

# Test frontend
echo "1. Testing Frontend..."
FRONTEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://ditchcanvas.com)
if [ "$FRONTEND_STATUS" = "200" ]; then
  echo "   ✅ Frontend: OK (HTTP $FRONTEND_STATUS)"
else
  echo "   ❌ Frontend: Failed (HTTP $FRONTEND_STATUS)"
fi

# Test API health
echo "2. Testing API Health..."
HEALTH_RESPONSE=$(curl -s https://ditchcanvas.com/api/health)
if echo "$HEALTH_RESPONSE" | grep -q "ok"; then
  echo "   ✅ API Health: OK"
  echo "      Response: $HEALTH_RESPONSE"
else
  echo "   ❌ API Health: Failed"
  echo "      Response: $HEALTH_RESPONSE"
fi

# Test check-email endpoint
echo "3. Testing Check Email Endpoint..."
EMAIL_RESPONSE=$(curl -s -X POST https://ditchcanvas.com/api/streaming-auth/check-email \
  -H "Content-Type: application/json" \
  -d '{"email":"test@colorado.edu"}')
if echo "$EMAIL_RESPONSE" | grep -q "success"; then
  echo "   ✅ Check Email: OK"
  echo "      Response: $EMAIL_RESPONSE"
else
  echo "   ❌ Check Email: Failed"
  echo "      Response: $EMAIL_RESPONSE"
fi

echo ""
echo "================================"
echo "✅ Deployment Test Complete!"
echo ""
echo "If all tests passed, the API is working correctly."
echo "If you see 'Load failed' in the browser:"
echo "  1. Check browser console for specific errors"
echo "  2. Verify environment variables are set in Vercel"
echo "  3. Check that SUPABASE_URL and SUPABASE_SERVICE_KEY are configured"

