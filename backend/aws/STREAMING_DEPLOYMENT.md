# Streaming Cookie Extraction - AWS EC2 Deployment

This guide explains how to deploy and run the streaming cookie extraction script on AWS EC2.

## Overview

The streaming script runs a headful Chromium browser on EC2, streams the browser content via WebSocket, and allows remote interaction through a web interface.

## Architecture

```
AWS EC2 Instance (i-09e83866e4ae5eeb2)
├─ Xvfb (Virtual Display Server)
├─ Chromium Browser (Headful, rendered via Xvfb)
├─ Playwright (CDP Control)
├─ Express Server (Port 3002)
├─ Socket.IO (WebSocket Streaming)
└─ Browser Frames → WebSocket → HTML5 Client
```

## Prerequisites

1. **AWS CLI configured** with appropriate credentials
2. **EC2 Instance** running (i-09e83866e4ae5eeb2)
3. **SSH Key** file (default: `Canvas-Wrapper.pem`)
4. **Node.js** installed locally (for deployment script)

## Quick Start

### 1. Set Environment Variables

```bash
export AWS_INSTANCE_ID=i-09e83866e4ae5eeb2
export AWS_KEY_FILE=/path/to/Canvas-Wrapper.pem
export AWS_REGION=us-east-1
export STREAMING_PORT=3002
export AWS_SSH_USER=ec2-user  # or 'ubuntu' for Ubuntu instances
```

Or create a `.env` file in the `backend` directory:

```env
AWS_INSTANCE_ID=i-09e83866e4ae5eeb2
AWS_KEY_FILE=../Canvas-Wrapper.pem
AWS_REGION=us-east-1
STREAMING_PORT=3002
AWS_SSH_USER=ec2-user
```

### 2. Deploy to EC2

```bash
cd backend
npm run aws:deploy-streaming
```

The deployment script will:
- ✅ Start the EC2 instance if needed
- ✅ Configure security groups to allow port 3002
- ✅ Install system dependencies (Node.js, Chrome, Xvfb)
- ✅ Deploy the streaming script
- ✅ Install Node.js dependencies
- ✅ Start the streaming server

### 3. Access the Streaming Interface

Once deployed, access the streaming interface at:
```
http://<EC2_PUBLIC_IP>:3002
```

The deployment script will output the exact URL.

## Manual Deployment Steps

If you prefer to deploy manually:

### 1. Configure Security Group

```bash
aws ec2 authorize-security-group-ingress \
  --group-id <your-security-group-id> \
  --protocol tcp \
  --port 3002 \
  --cidr 0.0.0.0/0
```

### 2. SSH into Instance

```bash
ssh -i Canvas-Wrapper.pem ec2-user@<EC2_PUBLIC_IP>
```

### 3. Install Dependencies

```bash
# For Amazon Linux
sudo yum update -y
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs chromium xorg-x11-server-Xvfb

# For Ubuntu
sudo apt-get update -y
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
sudo apt-get install -y nodejs google-chrome-stable xvfb
```

### 4. Deploy Script

```bash
# On local machine
rsync -avz -e "ssh -i Canvas-Wrapper.pem" \
  src/core/extract-cookies-streaming.js \
  ec2-user@<EC2_PUBLIC_IP>:~/canvas-wrapper-streaming/
```

### 5. Install Node Dependencies

```bash
# On EC2 instance
cd ~/canvas-wrapper-streaming
npm install --production
```

### 6. Start Xvfb and Run Script

```bash
# On EC2 instance
export DISPLAY=:99
Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
node extract-cookies-streaming.js
```

## Usage

1. **Access the Interface**: Open `http://<EC2_PUBLIC_IP>:3002` in your browser
2. **Interact with Browser**: Use mouse and keyboard to control the remote browser
3. **Login to Canvas**: Complete the login process through the streaming interface
4. **Automatic Detection**: The system will detect when login is complete
5. **Cookie Extraction**: Cookies are automatically extracted and saved

## Monitoring

### Check Server Status

```bash
ssh -i Canvas-Wrapper.pem ec2-user@<EC2_PUBLIC_IP> \
  "pgrep -f extract-cookies-streaming"
```

### View Logs

```bash
ssh -i Canvas-Wrapper.pem ec2-user@<EC2_PUBLIC_IP> \
  "tail -f ~/canvas-wrapper-streaming/streaming.log"
```

### Stop Server

```bash
ssh -i Canvas-Wrapper.pem ec2-user@<EC2_PUBLIC_IP> \
  "pkill -f extract-cookies-streaming"
```

## Troubleshooting

### Port Not Accessible

- Check security group allows port 3002
- Verify instance is running
- Check firewall rules on instance

### Browser Won't Start

- Verify Xvfb is running: `pgrep Xvfb`
- Check display: `echo $DISPLAY` (should be `:99`)
- Verify Chrome is installed: `google-chrome --version`

### Streaming Not Working

- Check server logs: `tail -f ~/canvas-wrapper-streaming/streaming.log`
- Verify Socket.IO connection in browser console
- Check CDP screencast is enabled

### Dependencies Missing

```bash
# Re-run dependency installation
ssh -i Canvas-Wrapper.pem ec2-user@<EC2_PUBLIC_IP> \
  "bash -s" < install-dependencies.sh
```

## Security Considerations

- **Security Group**: Only open port 3002 to trusted IPs if possible
- **HTTPS**: Consider using a reverse proxy (nginx) with SSL
- **Authentication**: Add authentication to the streaming interface for production use
- **Key File**: Keep your `.pem` file secure and never commit it

## Files

- `deploy-streaming.js` - Main deployment script
- `extract-cookies-streaming.js` - Streaming server script
- `STREAMING_DEPLOYMENT.md` - This file

## Support

For issues or questions, check:
- EC2 instance logs
- Security group configuration
- Network connectivity
- Browser console errors
