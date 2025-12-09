# VNC Login System

Server-side Canvas login system using EC2 with VNC, allowing users to complete manual Canvas login through their browser without installing Chromium locally.

## Architecture

```
User Browser  <-->  noVNC (port 80)  <-->  x11vnc  <-->  Xvfb :99  <-->  Chromium (headful)
                                                                               ^
                                                                               |
                                                              Playwright monitors login & extracts cookies
```

## Prerequisites

1. **EC2 Instance** (t3.medium recommended, 2 vCPU, 4GB RAM)
   - Ubuntu 22.04 LTS
   - Security Group: TCP 22 (SSH), TCP 80 (noVNC), TCP 5900 (VNC - optional)
   - 20GB storage

2. **Node.js 18+** (for fetch API support)

3. **Backend server** accessible from EC2 (for callback URL)

## Setup Instructions

### 1. Initial EC2 Setup

SSH into your EC2 instance and run:

```bash
# Clone or copy the setup script
sudo bash setup-vnc-server.sh
```

This installs:
- Chromium browser
- Xvfb (virtual display)
- x11vnc (VNC server)
- noVNC (web-based VNC client)
- Node.js and Playwright

### 2. Configure Supervisor

The setup script copies `supervisor-display.conf` to `/etc/supervisor/conf.d/display.conf`.

Start services:
```bash
sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl status
```

You should see:
- `xvfb` - running
- `x11vnc` - running  
- `novnc` - running

### 3. Deploy Login Script

From your local machine:

```bash
cd backend/aws/vnc-login
chmod +x deploy-to-ec2.sh
./deploy-to-ec2.sh <EC2_IP> <SSH_KEY_PATH> ubuntu
```

Or manually:
```bash
scp -i <key> vnc-login.js ubuntu@<EC2_IP>:/opt/app/
ssh -i <key> ubuntu@<EC2_IP> "chmod +x /opt/app/vnc-login.js"
```

### 4. Configure Backend

Add to your `.env` file:

```bash
# VNC Login Configuration
VNC_INSTANCE_ID=i-xxxxxxxxxxxxxxxxx
VNC_INSTANCE_IP=54.xxx.xxx.xxx  # Optional: use Elastic IP for static address
VNC_SSH_KEY_PATH=./Canvas-Wrapper.pem
VNC_SSH_USER=ubuntu
VNC_CALLBACK_URL=http://your-backend-url/api/vnc-auth/callback
VNC_NOVNC_PORT=80
VNC_LOGIN_TIMEOUT_MS=300000
VNC_REMOTE_SCRIPT_PATH=/opt/app/vnc-login.js
```

**Important**: `VNC_CALLBACK_URL` must be accessible from your EC2 instance. If your backend is on localhost, use:
- ngrok: `ngrok http 3000` → use the ngrok URL
- Or deploy backend to a public server

### 5. Test

1. Start your backend server
2. Call `POST /api/vnc-auth/start-session`
3. Open the returned `vncUrl` in browser
4. **Interactive Mode**: Use your keyboard and mouse to interact with the VNC window
   - Click anywhere in the VNC canvas to ensure it has focus
   - Type your username and password directly in the remote browser
   - Click buttons and navigate as you would in a normal browser
5. Complete Canvas login in the noVNC window
6. Poll `GET /api/vnc-auth/session/:token/status` until status is `completed`
7. Retrieve cookies and username from session

## Interactive Usage Guide

The VNC system is **fully interactive** - you can use your keyboard and mouse to control the remote browser directly through the web interface.

### Getting Started with Interactive Input

1. **Open the VNC URL** in your browser (provided after starting a session)
2. **Click in the VNC canvas** - This ensures the remote desktop has focus and will receive your input
3. **Type normally** - Your keyboard input will be sent to the remote browser
4. **Use your mouse** - Click, drag, and scroll work just like a normal desktop
5. **Complete the login** - Enter your Canvas credentials and navigate normally

### Tips for Best Experience

- **Focus**: Click anywhere in the VNC window before typing to ensure keyboard input works
- **Window Size**: The browser is automatically sized to 1920x1080 for optimal viewing
- **Navigation**: Use your mouse to click buttons, links, and form fields
- **Scrolling**: Scroll with your mouse wheel or trackpad within the VNC canvas
- **If input doesn't work**: Try clicking in the VNC window again to regain focus

### Technical Details

- **View-only mode**: Disabled (`view_only=false`) - full keyboard/mouse control enabled
- **Auto-focus**: The browser window is automatically focused and sized when it opens
- **Keyboard layout**: US English keyboard layout is configured by default
- **Input handling**: x11vnc is configured with enhanced input flags for reliable keyboard/mouse support

## API Endpoints

### `POST /api/vnc-auth/start-session`

Starts a new login session. Returns:
```json
{
  "sessionToken": "uuid",
  "vncUrl": "http://EC2_IP/?session=uuid",
  "publicIp": "54.xxx.xxx.xxx"
}
```

### `GET /api/vnc-auth/session/:token/status`

Get session status:
```json
{
  "sessionToken": "uuid",
  "status": "pending|active|completed|error|cancelled",
  "vncUrl": "http://...",
  "cookies": [...],
  "username": "user@example.edu",
  "error": null
}
```

### `POST /api/vnc-auth/session/:token/cancel`

Cancel an active session.

### `POST /api/vnc-auth/callback`

Internal endpoint - called by EC2 instance after login completes.

## Troubleshooting

### noVNC not accessible
- Check security group allows TCP port 80
- Verify supervisor services are running: `sudo supervisorctl status`
- Check logs: `sudo tail -f /var/log/novnc.log`

### Login script fails
- Check Node.js version: `node --version` (needs 18+)
- Check logs: `/var/log/vnc-login-<session-token>.log`
- Verify DISPLAY=:99 is set
- Test manually: `DISPLAY=:99 node /opt/app/vnc-login.js <token> <callback>`

### Callback not received
- Verify `VNC_CALLBACK_URL` is accessible from EC2
- Check backend logs for callback requests
- Test connectivity: `curl -X POST <callback-url> -H "Content-Type: application/json" -d '{"test":true}'`

### Chromium not launching
- Check Xvfb is running: `sudo supervisorctl status xvfb`
- Verify display: `DISPLAY=:99 xdpyinfo`
- Check Chromium path: `which chromium-browser` or `which chromium`

## Files

- `setup-vnc-server.sh` - Initial EC2 setup script
- `supervisor-display.conf` - Supervisor configuration for display services
- `vnc-login.js` - Main login script (runs on EC2)
- `session-manager.js` - Session tracking (runs on backend)
- `deploy-to-ec2.sh` - Deployment helper script
- `README.md` - This file

## Security Notes

- VNC password is disabled (`-nopw`) - consider adding password for production
- noVNC runs on port 80 (HTTP) - consider HTTPS reverse proxy
- Sessions expire after 15 minutes by default
- Consider IP whitelisting for noVNC access

