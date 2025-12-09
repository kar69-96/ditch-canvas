#!/usr/bin/env bash
set -euo pipefail

# Installs Chromium + Xvfb + VNC + noVNC + Node.js on Ubuntu 22.04/AMZ Linux
# Then copies supervisor config (if present alongside this script) and restarts supervisor.

if [[ $(id -u) -ne 0 ]]; then
  echo "Please run as root (use sudo)"
  exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SUPERVISOR_CONF_SOURCE="${SCRIPT_DIR}/supervisor-display.conf"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y \
  chromium-browser \
  xvfb \
  x11vnc \
  git \
  wget \
  curl \
  supervisor \
  libnss3 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libdrm2 \
  libxkbcommon0 \
  libasound2 \
  fonts-liberation \
  libxss1 \
  libxtst6 \
  libxrandr2 \
  libgbm1

# Install Node.js 18+ (required for fetch API)
if ! command -v node &> /dev/null || [[ $(node -v | cut -d'v' -f2 | cut -d'.' -f1) -lt 18 ]]; then
  echo "Installing Node.js 18+..."
  curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
  apt-get install -y nodejs
fi

# Install noVNC + websockify
if [[ ! -d /opt/novnc ]]; then
  git clone https://github.com/novnc/noVNC.git /opt/novnc
fi
if [[ ! -d /opt/novnc/utils/websockify ]]; then
  git clone https://github.com/novnc/websockify.git /opt/novnc/utils/websockify
fi
# ensure index.html points to vnc.html
ln -sf /opt/novnc/vnc.html /opt/novnc/index.html

# Prepare app directory for Playwright script
mkdir -p /opt/app
cd /opt/app
if [[ ! -f package.json ]]; then
  npm init -y
fi
npm install --save playwright-core

# Copy supervisor config if present in repo
if [[ -f "${SUPERVISOR_CONF_SOURCE}" ]]; then
  cp "${SUPERVISOR_CONF_SOURCE}" /etc/supervisor/conf.d/display.conf
  supervisorctl reread || true
  supervisorctl update || true
fi

echo "Setup complete. Start/verify services with: supervisorctl status"

