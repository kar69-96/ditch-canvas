# VNC Login System - Setup Checklist

## ✅ Completed Implementation

All code files have been created:
- ✅ EC2 setup script (`setup-vnc-server.sh`)
- ✅ Supervisor configuration (`supervisor-display.conf`)
- ✅ VNC login script (`vnc-login.js`)
- ✅ Session manager (`session-manager.js`)
- ✅ API routes (`src/routes/vnc-auth.js`)
- ✅ Server integration (routes registered in `server.js`)
- ✅ EC2 manager helpers (`checkNoVncHealth` function)
- ✅ Deployment script (`deploy-to-ec2.sh`)
- ✅ Documentation (`README.md`)

## 🔧 What You Need To Do

### 1. Create/Configure EC2 Instance

- Launch Ubuntu 22.04 instance (t3.medium recommended)
- Configure security group:
  - TCP 22 (SSH)
  - TCP 80 (noVNC)
  - TCP 5900 (VNC - optional)
- Note the instance ID and public IP

### 2. Initial EC2 Setup

SSH into instance and run setup:

```bash
# Copy setup script to instance
scp -i <key> backend/aws/vnc-login/setup-vnc-server.sh ubuntu@<EC2_IP>:/tmp/
scp -i <key> backend/aws/vnc-login/supervisor-display.conf ubuntu@<EC2_IP>:/tmp/

# SSH into instance
ssh -i <key> ubuntu@<EC2_IP>

# Run setup (as root)
sudo bash /tmp/setup-vnc-server.sh

# Verify services
sudo supervisorctl status
```

### 3. Deploy Login Script

```bash
cd backend/aws/vnc-login
./deploy-to-ec2.sh <EC2_IP> <SSH_KEY_PATH> ubuntu
```

### 4. Configure Backend Environment

Add to `backend/.env`:

```bash
# VNC Login Configuration
VNC_INSTANCE_ID=i-xxxxxxxxxxxxxxxxx
VNC_INSTANCE_IP=54.xxx.xxx.xxx
VNC_SSH_KEY_PATH=./Canvas-Wrapper.pem
VNC_SSH_USER=ubuntu
VNC_CALLBACK_URL=http://your-backend-url/api/vnc-auth/callback
VNC_NOVNC_PORT=80
VNC_LOGIN_TIMEOUT_MS=300000
VNC_REMOTE_SCRIPT_PATH=/opt/app/vnc-login.js
```

**Critical**: `VNC_CALLBACK_URL` must be publicly accessible from EC2. Options:
- Use ngrok: `ngrok http 3000` → use the ngrok HTTPS URL
- Deploy backend to a public server
- Use Elastic IP + public domain

### 5. Test the System

1. Start backend: `npm start`
2. Call API: `POST http://localhost:3000/api/vnc-auth/start-session`
3. Open returned `vncUrl` in browser
4. Complete Canvas login in noVNC window
5. Poll status: `GET /api/vnc-auth/session/:token/status`
6. Retrieve cookies when status is `completed`

## 🔍 Potential Issues & Fixes

### Issue: fetch() not available
**Fix**: Node.js 18+ is required. The setup script installs Node 18+, but if you see errors, verify:
```bash
node --version  # Should be v18.0.0 or higher
```

### Issue: SSH user mismatch
**Fix**: Ubuntu 22.04 uses `ubuntu` user, Amazon Linux uses `ec2-user`. Update `VNC_SSH_USER` in `.env` accordingly.

### Issue: Callback URL not accessible
**Fix**: 
- Use ngrok for local development
- Or deploy backend to a public server
- Test: `curl -X POST <callback-url> -H "Content-Type: application/json" -d '{"test":true}'`

### Issue: noVNC not loading
**Fix**:
- Check security group allows port 80
- Verify supervisor: `sudo supervisorctl status novnc`
- Check logs: `sudo tail -f /var/log/novnc.log`

### Issue: Chromium not launching
**Fix**:
- Verify Xvfb: `DISPLAY=:99 xdpyinfo`
- Check Chromium path: `which chromium-browser`
- Check logs: `/var/log/vnc-login-<token>.log`

## 📝 Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VNC_INSTANCE_ID` | Yes | - | EC2 instance ID |
| `VNC_INSTANCE_IP` | No | - | Static IP (Elastic IP recommended) |
| `VNC_SSH_KEY_PATH` | Yes | - | Path to SSH private key |
| `VNC_SSH_USER` | No | `ubuntu` | SSH username |
| `VNC_CALLBACK_URL` | Yes | - | Backend callback endpoint |
| `VNC_NOVNC_PORT` | No | `80` | noVNC web port |
| `VNC_LOGIN_TIMEOUT_MS` | No | `300000` | Login timeout (5 min) |
| `VNC_REMOTE_SCRIPT_PATH` | No | `/opt/app/vnc-login.js` | Path to script on EC2 |

## 🚀 Next Steps

1. Follow checklist above
2. Test with a single login session
3. Monitor logs for any issues
4. Consider adding authentication/authorization to API endpoints
5. Add HTTPS reverse proxy for production
6. Consider session cleanup automation

