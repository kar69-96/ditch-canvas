#!/usr/bin/env bash
set -euo pipefail

# Deploys vnc-login.js and related files to EC2 instance
# Usage: ./deploy-to-ec2.sh <instance-ip> <ssh-key-path> [ssh-user]

INSTANCE_IP="${1:-}"
SSH_KEY="${2:-}"
SSH_USER="${3:-ec2-user}"

if [[ -z "$INSTANCE_IP" || -z "$SSH_KEY" ]]; then
  echo "Usage: $0 <instance-ip> <ssh-key-path> [ssh-user]"
  echo "Example: $0 54.123.45.67 ~/.ssh/my-key.pem ubuntu"
  exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

echo "📦 Deploying VNC login files to EC2 instance..."

# Copy vnc-login.js to /opt/app/
echo "→ Copying vnc-login.js..."
scp -i "$SSH_KEY" \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  "${SCRIPT_DIR}/vnc-login.js" \
  "${SSH_USER}@${INSTANCE_IP}:/opt/app/vnc-login.js"

# Make it executable
ssh -i "$SSH_KEY" \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  "${SSH_USER}@${INSTANCE_IP}" \
  "chmod +x /opt/app/vnc-login.js"

# Copy supervisor config and restart services
echo "→ Copying supervisor config..."
scp -i "$SSH_KEY" \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  "${SCRIPT_DIR}/supervisor-display.conf" \
  "${SSH_USER}@${INSTANCE_IP}:/tmp/supervisor-display.conf"

echo "→ Updating supervisor config and restarting services..."
ssh -i "$SSH_KEY" \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  "${SSH_USER}@${INSTANCE_IP}" \
  "sudo cp /tmp/supervisor-display.conf /etc/supervisord.d/display.ini 2>/dev/null || sudo cp /tmp/supervisor-display.conf /etc/supervisor/conf.d/display.conf; sudo supervisorctl reread; sudo supervisorctl update; sudo supervisorctl restart all"

echo "✅ Deployment complete!"
echo ""
echo "Files deployed:"
echo "   - /opt/app/vnc-login.js"
echo "   - supervisor-display.conf"
echo ""
echo "To verify, check: supervisorctl status"
echo "To view VNC: http://${INSTANCE_IP}:80/vnc_lite.html"

