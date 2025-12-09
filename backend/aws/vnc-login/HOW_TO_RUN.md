# How to Run the VNC Login System

## Prerequisites

1. **Environment Variables** - Make sure your `backend/.env` has:
   ```bash
   VNC_INSTANCE_ID=i-09e83866e4ae5eeb2
   VNC_INSTANCE_IP=52.90.171.89
   VNC_SSH_KEY_PATH=./Canvas-Wrapper.pem
   VNC_SSH_USER=ec2-user
   VNC_CALLBACK_URL=http://your-backend-url/api/vnc-auth/callback
   VNC_NOVNC_PORT=80
   VNC_LOGIN_TIMEOUT_MS=300000
   VNC_REMOTE_SCRIPT_PATH=/opt/app/vnc-login.js
   ```

   **Important**: Replace `your-backend-url` with your actual backend URL. If running locally:
   - Use ngrok: `ngrok http 3000` then use the ngrok URL
   - Or use your public IP/domain if accessible from EC2

2. **Backend Server Running** - Start your backend:
   ```bash
   cd backend
   npm start
   # or
   node server.js
   ```

## Step-by-Step Usage

### Step 1: Start a VNC Login Session

Make a POST request to start a session:

```bash
curl -X POST http://localhost:3000/api/vnc-auth/start-session \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "sessionToken": "abc123...",
  "vncUrl": "http://52.90.171.89/?session=abc123...",
  "publicIp": "52.90.171.89"
}
```

### Step 2: Open the noVNC URL

Open the `vncUrl` from the response in your browser. This will show you the remote desktop on the EC2 instance.

### Step 3: Complete Canvas Login

In the noVNC browser window:
1. You'll see a Chrome browser window
2. Navigate to Canvas (should already be open)
3. Complete your Canvas login manually
4. Wait until you reach the Canvas dashboard

The script will automatically detect when you're logged in and extract cookies + username.

### Step 4: Check Session Status

Poll the status endpoint to see when login completes:

```bash
curl http://localhost:3000/api/vnc-auth/session/YOUR_SESSION_TOKEN/status
```

**Response (while waiting):**
```json
{
  "sessionToken": "abc123...",
  "status": "active",
  "vncUrl": "http://52.90.171.89/?session=abc123...",
  "createdAt": "2025-12-06T...",
  "expiresAt": "2025-12-06T..."
}
```

**Response (when complete):**
```json
{
  "sessionToken": "abc123...",
  "status": "completed",
  "cookies": [...],
  "username": "user@example.com",
  "metadata": {
    "extractedAt": "2025-12-06T...",
    "finalUrl": "https://canvas.colorado.edu/",
    "source": "vnc-login"
  }
}
```

### Step 5: Use the Extracted Data

Once status is `completed`, you'll have:
- **Cookies**: Array of Canvas cookies ready to use
- **Username**: The username used during login
- **Metadata**: Additional extraction information

The cookies are also saved to `backend/data/auth/canvas-cookies.json` (if callback is configured).

## Example JavaScript/TypeScript Usage

```javascript
// 1. Start session
const startResponse = await fetch('http://localhost:3000/api/vnc-auth/start-session', {
  method: 'POST'
});
const { sessionToken, vncUrl } = await startResponse.json();

// 2. Open noVNC URL (in browser)
window.open(vncUrl, '_blank');

// 3. Poll for completion
const checkStatus = async () => {
  const response = await fetch(`http://localhost:3000/api/vnc-auth/session/${sessionToken}/status`);
  const session = await response.json();
  
  if (session.status === 'completed') {
    console.log('Login complete!');
    console.log('Username:', session.username);
    console.log('Cookies:', session.cookies);
    return session;
  } else if (session.status === 'failed') {
    console.error('Login failed:', session.error);
    return null;
  } else {
    // Still waiting, check again in 2 seconds
    setTimeout(checkStatus, 2000);
  }
};

checkStatus();
```

## Example Python Usage

```python
import requests
import time

# 1. Start session
response = requests.post('http://localhost:3000/api/vnc-auth/start-session')
data = response.json()
session_token = data['sessionToken']
vnc_url = data['vncUrl']

print(f"Open this URL: {vnc_url}")

# 2. Poll for completion
while True:
    response = requests.get(f'http://localhost:3000/api/vnc-auth/session/{session_token}/status')
    session = response.json()
    
    if session['status'] == 'completed':
        print(f"Login complete! Username: {session['username']}")
        print(f"Cookies: {session['cookies']}")
        break
    elif session['status'] == 'failed':
        print(f"Login failed: {session.get('error')}")
        break
    else:
        print("Waiting for login...")
        time.sleep(2)
```

## Troubleshooting

### Session Not Starting
- Check EC2 instance is running: `aws ec2 describe-instances --instance-ids i-09e83866e4ae5eeb2`
- Verify SSH key path is correct
- Check backend logs for errors

### Callback Not Working
- Ensure `VNC_CALLBACK_URL` is publicly accessible
- For local dev, use ngrok: `ngrok http 3000`
- Check EC2 can reach your callback URL

### Login Timeout
- Default timeout is 5 minutes (300000ms)
- Increase `VNC_LOGIN_TIMEOUT_MS` if needed
- Check noVNC connection is stable

### Status Stuck on "active"
- Check EC2 logs: `ssh -i Canvas-Wrapper.pem ec2-user@52.90.171.89 "tail -f /var/log/vnc-login-*.log"`
- Verify the login script is running
- Check supervisor status: `ssh ... "sudo supervisorctl status"`

## API Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/vnc-auth/start-session` | Start a new VNC login session |
| GET | `/api/vnc-auth/session/:token/status` | Get session status and results |
| POST | `/api/vnc-auth/session/:token/cancel` | Cancel an active session |
| POST | `/api/vnc-auth/callback` | Internal callback (used by EC2 script) |

## Quick Test

```bash
# 1. Start session
SESSION=$(curl -s -X POST http://localhost:3000/api/vnc-auth/start-session | jq -r '.sessionToken')
VNC_URL=$(curl -s -X POST http://localhost:3000/api/vnc-auth/start-session | jq -r '.vncUrl')

# 2. Print URL to open
echo "Open this URL: $VNC_URL"

# 3. Poll status (replace YOUR_TOKEN with actual token)
while true; do
  STATUS=$(curl -s http://localhost:3000/api/vnc-auth/session/$SESSION/status | jq -r '.status')
  echo "Status: $STATUS"
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    curl -s http://localhost:3000/api/vnc-auth/session/$SESSION/status | jq
    break
  fi
  sleep 2
done
```

