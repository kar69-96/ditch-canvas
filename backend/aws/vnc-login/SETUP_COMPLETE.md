# VNC Login System - Setup Complete ✅

## Instance Information

- **Instance ID**: `i-09e83866e4ae5eeb2`
- **Instance Type**: `t3.medium` (2 vCPU, 4GB RAM)
- **Public IP**: `52.90.171.89` (may change if instance is stopped/started)
- **Storage**: 20GB (12GB free)
- **OS**: Amazon Linux 2

## Services Status

All services are running and configured to start on boot:

- ✅ **Xvfb** - Virtual display server (display :99)
- ✅ **x11vnc** - VNC server (port 5900)
- ✅ **noVNC** - Web-based VNC client (port 80)
- ✅ **Supervisor** - Process manager (enabled on boot)

## Access URLs

- **noVNC Web Interface**: `http://52.90.171.89/`
- **Direct VNC** (optional): `52.90.171.89:5900`

## Installed Software

- ✅ **Node.js 16.20.2** (via nvm)
- ✅ **Google Chrome** (`/usr/bin/google-chrome`)
- ✅ **x11vnc 0.9.16** (`/usr/local/bin/x11vnc`)
- ✅ **Playwright-core** (in `/opt/app`)
- ✅ **node-fetch** (in `/opt/app`)
- ✅ **vnc-login.js** (`/opt/app/vnc-login.js`)

## Configuration Files

- **Supervisor Config**: `/etc/supervisord.conf`
- **Display Services Config**: `/etc/supervisord.d/display.ini`
- **Login Script**: `/opt/app/vnc-login.js`
- **noVNC**: `/opt/novnc/`

## Backend Configuration

Add these to your `backend/.env`:

```bash
# VNC Login Configuration
VNC_INSTANCE_ID=i-09e83866e4ae5eeb2
VNC_INSTANCE_IP=52.90.171.89
VNC_SSH_KEY_PATH=./Canvas-Wrapper.pem
VNC_SSH_USER=ec2-user
VNC_CALLBACK_URL=http://your-backend-url/api/vnc-auth/callback
VNC_NOVNC_PORT=80
VNC_LOGIN_TIMEOUT_MS=300000
VNC_REMOTE_SCRIPT_PATH=/opt/app/vnc-login.js
```

**Important**: Replace `your-backend-url` with your actual backend URL that's accessible from EC2.

## Testing

1. **Test noVNC access**:
   ```bash
   curl http://52.90.171.89/
   ```
   Should return HTML (200 OK)

2. **Test services**:
   ```bash
   ssh -i Canvas-Wrapper.pem ec2-user@52.90.171.89
   sudo /usr/local/bin/supervisorctl -c /etc/supervisord.conf status
   ```

3. **Test login script**:
   ```bash
   ssh -i Canvas-Wrapper.pem ec2-user@52.90.171.89
   export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
   cd /opt/app
   DISPLAY=:99 SESSION_TOKEN=test CALLBACK_URL=http://test.com node vnc-login.js
   ```

## Security Group

Ensure these ports are open:
- ✅ TCP 22 (SSH) - Already open
- ✅ TCP 80 (noVNC) - Already open (verified accessible)
- ⚠️ TCP 5900 (VNC) - Optional, only if direct VNC access needed

## Notes

- **Chrome Path**: `/usr/bin/google-chrome` (configured in vnc-login.js)
- **Display**: `:99` (Xvfb virtual display)
- **Supervisor**: Starts automatically on boot via systemd
- **Node.js**: Available via nvm (load with: `source ~/.nvm/nvm.sh`)

## Troubleshooting

### Services not running
```bash
sudo /usr/local/bin/supervisorctl -c /etc/supervisord.conf restart all
```

### Check logs
```bash
sudo tail -f /var/log/xvfb.log
sudo tail -f /var/log/x11vnc.log
sudo tail -f /var/log/novnc.log
```

### Restart supervisor
```bash
sudo systemctl restart supervisord
```

## Next Steps

1. Configure backend `.env` with VNC instance details
2. Ensure `VNC_CALLBACK_URL` is publicly accessible (use ngrok for local dev)
3. Test the API endpoint: `POST /api/vnc-auth/start-session`
4. Open returned `vncUrl` in browser
5. Complete Canvas login via noVNC
6. Poll status endpoint until login completes

Setup completed on: 2025-12-06

