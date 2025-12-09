#!/usr/bin/env bash
set -euo pipefail

# Installs Chromium + Xvfb + VNC + noVNC + Node.js on Amazon Linux 2023
# Then copies supervisor config and restarts supervisor.

if [[ $(id -u) -ne 0 ]]; then
  echo "Please run as root (use sudo)"
  exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SUPERVISOR_CONF_SOURCE="${SCRIPT_DIR}/supervisor-display.conf"

# Detect package manager
if command -v dnf &> /dev/null; then
  PKG_MGR=dnf
  PKG_INSTALL="dnf install -y"
  PKG_UPDATE="dnf update -y"
elif command -v yum &> /dev/null; then
  PKG_MGR=yum
  PKG_INSTALL="yum install -y"
  PKG_UPDATE="yum update -y"
else
  echo "Error: Neither dnf nor yum found"
  exit 1
fi

# Update packages
$PKG_UPDATE

# Install packages
$PKG_INSTALL \
  chromium \
  xorg-x11-server-Xvfb \
  x11vnc \
  git \
  wget \
  curl \
  supervisor \
  nss \
  atk \
  at-spi2-atk \
  libdrm \
  libxkbcommon \
  alsa-lib \
  liberation-fonts \
  libXScrnSaver \
  libXtst \
  libXrandr \
  mesa-libgbm \
  mesa-dri-drivers \
  xorg-x11-utils || true  # xdpyinfo for debugging

# Try to install openbox window manager (helps with browser rendering)
$PKG_INSTALL openbox || echo "Note: openbox not available, browser may work without it"

# Install Node.js 18+ (required for fetch API)
if ! command -v node &> /dev/null || [[ $(node -v | cut -d'v' -f2 | cut -d'.' -f1) -lt 18 ]]; then
  echo "Installing Node.js 18+..."
  curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
  $PKG_INSTALL nodejs
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

# Copy supervisor config if present
if [[ -f "${SUPERVISOR_CONF_SOURCE}" ]]; then
  cp "${SUPERVISOR_CONF_SOURCE}" /etc/supervisord.d/display.ini
  systemctl restart supervisord || supervisorctl reread
  supervisorctl update || true
fi

echo "Setup complete. Start/verify services with: supervisorctl status"

