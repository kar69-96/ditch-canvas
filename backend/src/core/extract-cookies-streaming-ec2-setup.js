#!/usr/bin/env node
/**
 * One-time setup script for EC2 instance
 * Installs all dependencies, Chrome, Xvfb, and Node.js packages
 * Run this once when setting up a new EC2 instance
 */

const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// Load .env if exists
const dotenv = require('dotenv');
const backendEnvPath = path.join(__dirname, '..', '..', '.env');
const rootEnvPath = path.join(__dirname, '..', '..', '..', '.env');

if (fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath });
} else if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  dotenv.config();
}

// Configuration
const AWS_INSTANCE_ID = process.env.AWS_INSTANCE_ID || 'i-09e83866e4ae5eeb2';
const AWS_KEY_FILE = process.env.AWS_KEY_FILE || path.join(__dirname, '..', '..', '..', 'Canvas-Wrapper.pem');
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const AWS_SSH_USER = process.env.AWS_SSH_USER || 'ec2-user';

// Get EC2 public IP
async function getEC2PublicIP() {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);

  try {
    const { stdout } = await execAsync(
      `aws ec2 describe-instances --instance-ids ${AWS_INSTANCE_ID} --region ${AWS_REGION} --query 'Reservations[0].Instances[0].PublicIpAddress' --output text`
    );
    const ip = stdout.trim();
    
    if (!ip || ip === 'None' || ip === 'null') {
      throw new Error('Instance does not have a public IP address. Is the instance running?');
    }
    
    return ip;
  } catch (error) {
    console.error('❌ Error getting EC2 IP:', error.message);
    console.error('   Make sure AWS CLI is configured and instance is running');
    process.exit(1);
  }
}

// Execute command on EC2
async function executeCommand(publicIp, command, timeout = 300000) {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);

  try {
    const sshCommand = `ssh -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${AWS_SSH_USER}@${publicIp} "${command}"`;
    const { stdout, stderr } = await execAsync(sshCommand, { timeout });
    return { success: true, stdout, stderr };
  } catch (error) {
    return { success: false, error: error.message, stdout: error.stdout, stderr: error.stderr };
  }
}

// One-time setup: Install all dependencies
async function setupEC2Instance(publicIp) {
  console.log('🔧 Running one-time setup on EC2 instance...\n');

  // Detect OS
  console.log('📋 Detecting OS...');
  const osCheck = await executeCommand(publicIp, 'cat /etc/os-release | grep "^ID=" | cut -d "=" -f 2 | tr -d \'"\'');
  let osType = 'amzn';
  if (osCheck.success && osCheck.stdout) {
    const osId = osCheck.stdout.trim().toLowerCase();
    if (osId.includes('ubuntu') || osId.includes('debian')) {
      osType = 'ubuntu';
    } else if (osId.includes('rhel') || osId.includes('centos')) {
      osType = 'rhel';
    }
  }
  console.log(`   Detected: ${osType}\n`);

  // Install system dependencies
  console.log('📦 Installing system dependencies (this may take a few minutes)...');
  const systemDepsScript = `
set -e
echo "📦 Installing system packages..."

if command -v dnf &> /dev/null; then
  # Amazon Linux 2023
  sudo dnf update -y
  # curl is already installed as curl-minimal, skip it
  sudo dnf install -y git wget xorg-x11-server-Xvfb xorg-x11-xauth
  # xorg-x11-apps is optional and may not be available on AL2023
  sudo dnf install -y xorg-x11-apps 2>/dev/null || true
  if ! command -v node &> /dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
    sudo dnf install -y nodejs
  fi
elif command -v yum &> /dev/null; then
  # Amazon Linux 2
  sudo yum update -y
  sudo yum install -y git curl wget xorg-x11-server-Xvfb xorg-x11-xauth xorg-x11-apps
  if ! command -v node &> /dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
    sudo yum install -y nodejs
  fi
elif command -v apt-get &> /dev/null; then
  # Ubuntu/Debian
  sudo apt-get update -y
  sudo apt-get install -y git curl wget xvfb x11-apps x11-xserver-utils
  if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
    sudo apt-get install -y nodejs
  fi
fi

echo "✅ System packages installed"
node --version
npm --version
`.trim();

  const systemResult = await executeCommand(publicIp, systemDepsScript, 600000);
  if (!systemResult.success) {
    console.error('❌ Failed to install system dependencies');
    console.error(systemResult.error || systemResult.stderr);
    return false;
  }
  console.log('✅ System dependencies installed\n');

  // Install Chrome
  console.log('🌐 Installing Chrome...');
  const chromeScript = `
set -e
if command -v google-chrome &> /dev/null || command -v google-chrome-stable &> /dev/null || command -v chromium &> /dev/null || command -v chromium-browser &> /dev/null; then
  echo "✅ Chrome/Chromium already installed"
  which google-chrome google-chrome-stable chromium chromium-browser 2>/dev/null | head -1
  exit 0
fi

echo "📥 Downloading and installing Chrome..."

if command -v dnf &> /dev/null; then
  cd /tmp
  wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm
  sudo dnf install -y ./google-chrome-stable_current_x86_64.rpm
  rm -f google-chrome-stable_current_x86_64.rpm
elif command -v yum &> /dev/null; then
  cd /tmp
  wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm
  sudo yum install -y ./google-chrome-stable_current_x86_64.rpm
  rm -f google-chrome-stable_current_x86_64.rpm
elif command -v apt-get &> /dev/null; then
  wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
  echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
  sudo apt-get update -y
  sudo apt-get install -y google-chrome-stable
fi

which google-chrome google-chrome-stable chromium chromium-browser 2>/dev/null | head -1
`.trim();

  const chromeResult = await executeCommand(publicIp, chromeScript, 300000);
  if (!chromeResult.success) {
    console.error('❌ Failed to install Chrome');
    console.error(chromeResult.error || chromeResult.stderr);
    return false;
  }
  if (chromeResult.stdout) {
    console.log(`✅ Chrome installed: ${chromeResult.stdout.trim()}\n`);
  } else {
    console.log('✅ Chrome installation completed\n');
  }

  // Setup directory and copy files
  console.log('📁 Setting up streaming directory...');
  await executeCommand(publicIp, 'mkdir -p ~/canvas-wrapper-streaming');

  const streamingScriptPath = path.join(__dirname, 'extract-cookies-streaming.js');
  const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');

  // Copy script
  console.log('📤 Copying streaming script...');
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);

  await execAsync(`scp -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "${streamingScriptPath}" ${AWS_SSH_USER}@${publicIp}:~/canvas-wrapper-streaming/extract-cookies-streaming.js`);

  // Copy package.json
  if (fs.existsSync(packageJsonPath)) {
    console.log('📋 Copying package.json...');
    await execAsync(`scp -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "${packageJsonPath}" ${AWS_SSH_USER}@${publicIp}:~/canvas-wrapper-streaming/package.json`);
  }

  // Install Node.js dependencies
  console.log('📦 Installing Node.js dependencies (this may take a few minutes)...');
  const npmInstallResult = await executeCommand(
    publicIp,
    'cd ~/canvas-wrapper-streaming && npm install --production --no-audit --no-fund',
    600000
  );

  if (!npmInstallResult.success) {
    console.error('❌ Failed to install Node.js dependencies');
    console.error(npmInstallResult.error || npmInstallResult.stderr);
    return false;
  }
  console.log('✅ Node.js dependencies installed\n');

  // Verify Xvfb can start
  console.log('🖥️  Testing Xvfb...');
  const xvfbTest = await executeCommand(
    publicIp,
    'pkill -f "Xvfb :99" 2>/dev/null || true; Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset > /tmp/xvfb.log 2>&1 & sleep 2; pgrep -f "Xvfb :99" > /dev/null && echo "Xvfb OK" || echo "Xvfb FAILED"'
  );

  if (xvfbTest.success && xvfbTest.stdout.includes('Xvfb OK')) {
    console.log('✅ Xvfb is working\n');
  } else {
    console.log('⚠️  Xvfb test unclear, but continuing...\n');
  }

  console.log('✅ Setup complete!');
  console.log('   You can now use: npm run auth:extract-cookies:streaming:fast\n');
  return true;
}

// Main function
async function main() {
  console.log('🔧 EC2 Instance Setup for Streaming Cookie Extraction');
  console.log('═══════════════════════════════════════════════════\n');
  console.log('📋 This will install:');
  console.log('   - Node.js 18.x');
  console.log('   - Google Chrome');
  console.log('   - Xvfb (virtual framebuffer)');
  console.log('   - Node.js dependencies');
  console.log('   - Streaming script\n');

  // Check key file
  if (!fs.existsSync(AWS_KEY_FILE)) {
    console.error(`❌ Error: AWS key file not found: ${AWS_KEY_FILE}`);
    console.error('   Please set AWS_KEY_FILE environment variable');
    process.exit(1);
  }

  // Get EC2 IP
  console.log(`📡 Getting EC2 instance IP (${AWS_INSTANCE_ID})...`);
  const publicIp = await getEC2PublicIP();
  console.log(`✅ EC2 Public IP: ${publicIp}\n`);

  // Run setup
  const success = await setupEC2Instance(publicIp);
  
  if (success) {
    console.log('\n🎉 Setup completed successfully!');
    console.log('   Instance is ready for fast-start streaming.\n');
  } else {
    console.error('\n❌ Setup failed. Please check the errors above.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});


