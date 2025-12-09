#!/bin/bash
#
# AWS CLI-based Setup for Streaming Cookie Extraction on EC2
# This script uses AWS CLI to configure and deploy the streaming server
#

set -e  # Exit on error

# Configuration
INSTANCE_ID="${AWS_INSTANCE_ID:-i-09e83866e4ae5eeb2}"
REGION="${AWS_REGION:-us-east-1}"
STREAMING_PORT="${STREAMING_PORT:-3002}"
SSH_USER="${AWS_SSH_USER:-ec2-user}"
KEY_FILE="${AWS_KEY_FILE:-../Canvas-Wrapper.pem}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 AWS CLI Streaming Deployment Setup${NC}"
echo -e "${BLUE}=======================================${NC}"
echo -e "Instance ID: ${INSTANCE_ID}"
echo -e "Region: ${REGION}"
echo -e "Port: ${STREAMING_PORT}"
echo -e ""

# Check AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI is not installed${NC}"
    echo -e "Install it from: https://aws.amazon.com/cli/"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}❌ AWS credentials not configured${NC}"
    echo -e "Run: aws configure"
    exit 1
fi

# Check key file exists
if [ ! -f "$KEY_FILE" ]; then
    echo -e "${RED}❌ Key file not found: ${KEY_FILE}${NC}"
    echo -e "Set AWS_KEY_FILE environment variable or place key file at: ${KEY_FILE}"
    exit 1
fi

# Make key file readable only by owner
chmod 400 "$KEY_FILE"

echo -e "${GREEN}✅ Prerequisites check passed${NC}\n"

# Step 1: Get instance details
echo -e "${BLUE}📋 Step 1: Getting instance details...${NC}"
INSTANCE_INFO=$(aws ec2 describe-instances \
    --instance-ids "$INSTANCE_ID" \
    --region "$REGION" \
    --query 'Reservations[0].Instances[0].[State.Name,PublicIpAddress,SecurityGroups[0].GroupId]' \
    --output text)

if [ -z "$INSTANCE_INFO" ] || [ "$INSTANCE_INFO" == "None" ]; then
    echo -e "${RED}❌ Instance not found or no access${NC}"
    exit 1
fi

read -r STATE PUBLIC_IP SECURITY_GROUP_ID <<< "$INSTANCE_INFO"

echo -e "   State: ${STATE}"
echo -e "   Public IP: ${PUBLIC_IP:-Not assigned yet}"
echo -e "   Security Group: ${SECURITY_GROUP_ID}"

# Start instance if stopped
if [ "$STATE" == "stopped" ]; then
    echo -e "\n${YELLOW}⏳ Starting instance...${NC}"
    aws ec2 start-instances --instance-ids "$INSTANCE_ID" --region "$REGION" > /dev/null
    
    echo -e "   Waiting for instance to be running..."
    aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"
    
    # Get new public IP
    PUBLIC_IP=$(aws ec2 describe-instances \
        --instance-ids "$INSTANCE_ID" \
        --region "$REGION" \
        --query 'Reservations[0].Instances[0].PublicIpAddress' \
        --output text)
    
    echo -e "${GREEN}✅ Instance started${NC}"
    echo -e "   Public IP: ${PUBLIC_IP}"
elif [ "$STATE" != "running" ]; then
    echo -e "${YELLOW}⏳ Waiting for instance to be running...${NC}"
    aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"
    
    PUBLIC_IP=$(aws ec2 describe-instances \
        --instance-ids "$INSTANCE_ID" \
        --region "$REGION" \
        --query 'Reservations[0].Instances[0].PublicIpAddress' \
        --output text)
fi

if [ -z "$PUBLIC_IP" ] || [ "$PUBLIC_IP" == "None" ]; then
    echo -e "${RED}❌ Instance does not have a public IP${NC}"
    exit 1
fi

# Step 2: Configure security group
echo -e "\n${BLUE}🔒 Step 2: Configuring security group...${NC}"

# Check if port is already open
EXISTING_RULE=$(aws ec2 describe-security-groups \
    --group-ids "$SECURITY_GROUP_ID" \
    --region "$REGION" \
    --query "SecurityGroups[0].IpPermissions[?IpProtocol=='tcp' && FromPort<=${STREAMING_PORT} && ToPort>=${STREAMING_PORT}]" \
    --output text 2>/dev/null || echo "")

if [ -n "$EXISTING_RULE" ] && [ "$EXISTING_RULE" != "None" ]; then
    echo -e "   ${GREEN}✅ Port ${STREAMING_PORT} already allowed${NC}"
else
    echo -e "   Adding rule for port ${STREAMING_PORT}..."
    if aws ec2 authorize-security-group-ingress \
        --group-id "$SECURITY_GROUP_ID" \
        --protocol tcp \
        --port "$STREAMING_PORT" \
        --cidr 0.0.0.0/0 \
        --region "$REGION" \
        --description "Streaming server access" 2>/dev/null; then
        echo -e "   ${GREEN}✅ Port ${STREAMING_PORT} added${NC}"
    else
        EXIT_CODE=$?
        if [ $EXIT_CODE -eq 254 ]; then
            echo -e "   ${YELLOW}⚠️  Rule may already exist (duplicate)${NC}"
        else
            echo -e "   ${YELLOW}⚠️  Could not add rule (may already exist)${NC}"
        fi
    fi
fi

# Step 3: Wait for SSH
echo -e "\n${BLUE}🔌 Step 3: Waiting for SSH to be ready...${NC}"
echo -e "   Testing SSH connection to ${PUBLIC_IP}..."

MAX_ATTEMPTS=30
ATTEMPT=0
SSH_READY=false

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    if ssh -i "$KEY_FILE" \
        -o StrictHostKeyChecking=no \
        -o UserKnownHostsFile=/dev/null \
        -o ConnectTimeout=5 \
        -o BatchMode=yes \
        "${SSH_USER}@${PUBLIC_IP}" \
        "echo 'SSH ready'" &>/dev/null; then
        SSH_READY=true
        break
    fi
    
    ATTEMPT=$((ATTEMPT + 1))
    echo -e "   Attempt ${ATTEMPT}/${MAX_ATTEMPTS}..."
    sleep 5
done

if [ "$SSH_READY" = false ]; then
    echo -e "${RED}❌ SSH not ready after ${MAX_ATTEMPTS} attempts${NC}"
    exit 1
fi

echo -e "${GREEN}✅ SSH is ready${NC}"

# Step 4: Install dependencies
echo -e "\n${BLUE}📦 Step 4: Installing dependencies on EC2...${NC}"

# Detect OS and install
INSTALL_SCRIPT=$(cat <<'INSTALL_EOF'
set -e
echo "📦 Installing system dependencies..."

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
else
    OS="amzn"  # Default to Amazon Linux
fi

echo "Detected OS: $OS"

# Update package manager
if command -v yum &> /dev/null; then
    echo "Using yum package manager..."
    sudo yum update -y
    sudo yum install -y git curl wget unzip
    
    # Install Node.js 16.x compatible with glibc 2.26 (Amazon Linux 2)
    # Remove any nvm installations that require newer glibc
    if [ -d "$HOME/.nvm" ]; then
        echo "Removing incompatible nvm Node.js installations..."
        rm -rf "$HOME/.nvm"
    fi
    
    # Remove old symlinks
    sudo rm -f /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx 2>/dev/null || true
    
    # Install Node.js 16 from pre-built binary compatible with glibc 2.26
    if ! command -v node &> /dev/null || ! node --version 2>/dev/null | grep -q "v16"; then
        echo "Installing Node.js 16.x (compatible with glibc 2.26)..."
        cd /tmp
        wget -q https://nodejs.org/dist/v16.20.2/node-v16.20.2-linux-x64.tar.xz
        tar -xf node-v16.20.2-linux-x64.tar.xz
        sudo rm -rf /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx /usr/local/lib/node_modules 2>/dev/null || true
        sudo cp -r node-v16.20.2-linux-x64/* /usr/local/
        sudo ln -sf /usr/local/bin/node /usr/bin/node 2>/dev/null || true
        sudo ln -sf /usr/local/bin/npm /usr/bin/npm 2>/dev/null || true
        rm -rf node-v16.20.2-linux-x64*
        cd ~
    fi
    
    # Install Chrome/Chromium
    if ! command -v google-chrome &> /dev/null && ! command -v chromium &> /dev/null; then
        echo "Installing Chromium..."
        sudo yum install -y chromium
    fi
    
    # Install X11 and display server
    echo "Installing X11 display server..."
    sudo yum install -y xorg-x11-server-Xvfb xorg-x11-xauth xorg-x11-apps
    
elif command -v apt-get &> /dev/null; then
    echo "Using apt-get package manager..."
    sudo apt-get update -y
    sudo apt-get install -y git curl wget unzip
    
    # Install/Upgrade Node.js 18.x using nvm
    NODE_VERSION=$(node --version 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1 || echo "0")
    if [ "$NODE_VERSION" -lt 18 ] || ! command -v node &> /dev/null; then
        echo "Installing/Upgrading Node.js to 18.x using nvm..."
        # Install nvm if not present
        if [ ! -d "$HOME/.nvm" ]; then
            curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
            export NVM_DIR="$HOME/.nvm"
            [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        else
            export NVM_DIR="$HOME/.nvm"
            [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        fi
        # Install Node.js 18
        nvm install 18
        nvm use 18
        nvm alias default 18
        # Make node available system-wide
        sudo ln -sf "$(which node)" /usr/local/bin/node 2>/dev/null || true
        sudo ln -sf "$(which npm)" /usr/local/bin/npm 2>/dev/null || true
    fi
    
    # Install Chrome
    if ! command -v google-chrome &> /dev/null && ! command -v chromium-browser &> /dev/null; then
        echo "Installing Google Chrome..."
        wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
        echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
        sudo apt-get update -y
        sudo apt-get install -y google-chrome-stable
    fi
    
    # Install X11 and display server
    echo "Installing X11 display server..."
    sudo apt-get install -y xvfb x11-apps x11-xserver-utils
fi

# Verify installations
echo ""
echo "✅ Verifying installations..."
echo -n "Node.js: " && node --version || echo "❌ Not found"
echo -n "npm: " && npm --version || echo "❌ Not found"
echo -n "Chrome: " && (google-chrome --version 2>/dev/null || chromium --version 2>/dev/null || echo "❌ Not found")
which Xvfb && echo "✅ Xvfb installed" || echo "❌ Xvfb not found"

echo ""
echo "✅ System dependencies installed"
INSTALL_EOF
)

ssh -i "$KEY_FILE" \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    "${SSH_USER}@${PUBLIC_IP}" \
    "bash -s" <<< "$INSTALL_SCRIPT"

# Step 5: Create directory and deploy script
echo -e "\n${BLUE}📤 Step 5: Deploying streaming script...${NC}"

# Create remote directory
ssh -i "$KEY_FILE" \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    "${SSH_USER}@${PUBLIC_IP}" \
    "mkdir -p ~/canvas-wrapper-streaming"

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Copy streaming script
SCRIPT_PATH="$BACKEND_DIR/src/core/extract-cookies-streaming.js"
if [ ! -f "$SCRIPT_PATH" ]; then
    echo -e "${RED}❌ Streaming script not found: ${SCRIPT_PATH}${NC}"
    exit 1
fi

echo -e "   Copying streaming script..."
scp -i "$KEY_FILE" \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    "$SCRIPT_PATH" \
    "${SSH_USER}@${PUBLIC_IP}:~/canvas-wrapper-streaming/extract-cookies-streaming.js"

# Copy minimal package.json for streaming (compatible with Node 16)
STREAMING_PACKAGE_PATH="$SCRIPT_DIR/streaming-package.json"
if [ -f "$STREAMING_PACKAGE_PATH" ]; then
    echo -e "   Copying streaming package.json..."
    scp -i "$KEY_FILE" \
        -o StrictHostKeyChecking=no \
        -o UserKnownHostsFile=/dev/null \
        "$STREAMING_PACKAGE_PATH" \
        "${SSH_USER}@${PUBLIC_IP}:~/canvas-wrapper-streaming/package.json"
else
    # Fallback to full package.json
    PACKAGE_PATH="$BACKEND_DIR/package.json"
    if [ -f "$PACKAGE_PATH" ]; then
        echo -e "   Copying package.json..."
        scp -i "$KEY_FILE" \
            -o StrictHostKeyChecking=no \
            -o UserKnownHostsFile=/dev/null \
            "$PACKAGE_PATH" \
            "${SSH_USER}@${PUBLIC_IP}:~/canvas-wrapper-streaming/package.json"
    fi
fi

# Step 6: Install Node.js dependencies
echo -e "\n${BLUE}📦 Step 6: Installing Node.js dependencies...${NC}"

NPM_INSTALL_SCRIPT=$(cat <<'NPM_EOF'
cd ~/canvas-wrapper-streaming

# Use system Node.js 16 (already installed and compatible with Amazon Linux 2)
# Node.js 18 requires glibc 2.27+ but Amazon Linux 2 has 2.26
# The streaming script only needs express, socket.io, playwright-core, and dotenv
# which are compatible with Node.js 16

echo "Using system Node.js: $(node --version)"
echo "Using npm: $(npm --version)"

# Install dependencies
npm install --production --no-audit --no-fund
NPM_EOF
)

ssh -i "$KEY_FILE" \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    "${SSH_USER}@${PUBLIC_IP}" \
    "bash -s" <<< "$NPM_INSTALL_SCRIPT"

# Step 7: Start streaming server
echo -e "\n${BLUE}🚀 Step 7: Starting streaming server...${NC}"

START_SCRIPT=$(cat <<START_EOF
cd ~/canvas-wrapper-streaming

# Use system Node.js 16 (compatible with Amazon Linux 2)
# No need for nvm - system node works fine

# Set display
export DISPLAY=:99

# Start Xvfb in background if not running
if ! pgrep -x Xvfb > /dev/null; then
    echo "Starting Xvfb..."
    Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset > /dev/null 2>&1 &
    sleep 3
fi

# Verify Xvfb is running
if ! pgrep -x Xvfb > /dev/null; then
    echo "❌ Failed to start Xvfb"
    exit 1
fi

echo "✅ Xvfb is running"

# Kill any existing streaming server
pkill -f "extract-cookies-streaming" 2>/dev/null || true
sleep 1

# Run streaming script in background
echo "Starting streaming server on port ${STREAMING_PORT}..."
nohup node extract-cookies-streaming.js > streaming.log 2>&1 &

# Wait for server to start
sleep 5

# Check if process is running
if pgrep -f "extract-cookies-streaming" > /dev/null; then
    echo "✅ Streaming server started successfully"
    echo "Server is accessible at: http://${PUBLIC_IP}:${STREAMING_PORT}"
else
    echo "❌ Failed to start streaming server"
    echo "Check logs:"
    tail -20 streaming.log
    exit 1
fi
START_EOF
)

ssh -i "$KEY_FILE" \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    "${SSH_USER}@${PUBLIC_IP}" \
    "bash -s" <<< "$START_SCRIPT"

# Success!
echo -e "\n${GREEN}✅ Deployment Complete!${NC}"
echo -e "${GREEN}=======================================${NC}"
echo -e ""
echo -e "${BLUE}📊 Summary:${NC}"
echo -e "   Instance ID: ${INSTANCE_ID}"
echo -e "   Public IP: ${PUBLIC_IP}"
echo -e "   Streaming URL: ${GREEN}http://${PUBLIC_IP}:${STREAMING_PORT}${NC}"
echo -e ""
echo -e "${BLUE}📋 Useful Commands:${NC}"
echo -e "   View logs: ssh -i ${KEY_FILE} ${SSH_USER}@${PUBLIC_IP} 'tail -f ~/canvas-wrapper-streaming/streaming.log'"
echo -e "   Stop server: ssh -i ${KEY_FILE} ${SSH_USER}@${PUBLIC_IP} 'pkill -f extract-cookies-streaming'"
echo -e "   Check status: ssh -i ${KEY_FILE} ${SSH_USER}@${PUBLIC_IP} 'pgrep -f extract-cookies-streaming'"
echo -e ""
echo -e "${GREEN}🎉 Open http://${PUBLIC_IP}:${STREAMING_PORT} in your browser to start!${NC}"
