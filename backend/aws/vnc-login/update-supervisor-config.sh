#!/usr/bin/env bash
# Updates supervisor config for noVNC on EC2 instance
# Usage: ./update-supervisor-config.sh <instance-ip> <ssh-key-path> [ssh-user]

set -euo pipefail

INSTANCE_IP="${1:-}"
SSH_KEY="${2:-}"
SSH_USER="${3:-ec2-user}"

if [[ -z "$INSTANCE_IP" || -z "$SSH_KEY" ]]; then
  echo "Usage: $0 <instance-ip> <ssh-key-path> [ssh-user]"
  echo "Example: $0 54.123.45.67 ~/.ssh/my-key.pem ec2-user"
  exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

echo "📦 Updating supervisor config on EC2 instance..."

# Copy supervisor config
scp -i "$SSH_KEY" \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  "${SCRIPT_DIR}/supervisor-display.conf" \
  "${SSH_USER}@${INSTANCE_IP}:/tmp/supervisor-display.conf"

# Update supervisor config and restart
ssh -i "$SSH_KEY" \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  "${SSH_USER}@${INSTANCE_IP}" << 'EOF'
  sudo cp /tmp/supervisor-display.conf /etc/supervisord.d/display.ini
  sudo supervisorctl reread
  sudo supervisorctl update novnc
  sudo supervisorctl restart novnc
  sudo supervisorctl status novnc
EOF

echo "✅ Supervisor config updated!"
echo "   Check status: ssh -i $SSH_KEY ${SSH_USER}@${INSTANCE_IP} 'sudo supervisorctl status'"
