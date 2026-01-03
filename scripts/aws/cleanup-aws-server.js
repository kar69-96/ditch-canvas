#!/usr/bin/env node
/**
 * AWS Server Cleanup Script
 * Cleans up the AWS extraction server and ensures it's ready for extraction
 */

// Load .env file if it exists
const path = require('path');
const fs = require('fs');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [key, ...valueParts] = trimmed.split('=');
      const value = valueParts.join('=').replace(/^["']|["']$/g, '');
      if (key && value) {
        process.env[key.trim()] = value.trim();
      }
    }
  });
}

const { ensureInstanceReady, executeCommand, getInstanceDetails } = require('./utils/aws-ec2-manager.js');

// Configuration
const AWS_INSTANCE_ID = process.env.AWS_INSTANCE_ID || 'i-02e3289c96e66905c';
const AWS_KEY_FILE = process.env.AWS_KEY_FILE || path.join(__dirname, '..', 'Canvas-Wrapper.pem');
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const SSH_USER = process.env.AWS_SSH_USER || 'ec2-user';

/**
 * Check what's currently installed on the server
 */
async function checkCurrentState(publicIp, keyFile) {
  console.log('\n🔍 Checking current server state...');
  
  const checkCommand = `
    echo "=== System Info ===" && 
    cat /etc/os-release 2>/dev/null | grep -E "^ID=|^VERSION_ID=" && 
    echo "" && 
    echo "=== Node.js ===" && 
    (node --version 2>/dev/null || echo "Not installed") && 
    (npm --version 2>/dev/null || echo "Not installed") && 
    echo "" && 
    echo "=== Chrome/Chromium ===" && 
    (google-chrome --version 2>/dev/null || chromium --version 2>/dev/null || echo "Not installed") && 
    echo "" && 
    echo "=== Xvfb ===" && 
    (which Xvfb && echo "Installed" || echo "Not installed") && 
    echo "" && 
    echo "=== Home Directory Contents ===" && 
    ls -la ~ | head -20 && 
    echo "" && 
    echo "=== Running Processes ===" && 
    ps aux | grep -E "node|chrome|chromium|Xvfb|streaming" | grep -v grep | head -10 && 
    echo "" && 
    echo "=== Disk Usage ===" && 
    df -h / | tail -1
  `;
  
  const result = await executeCommand(publicIp, checkCommand, keyFile, 30000);
  console.log(result.stdout);
  if (result.stderr) {
    console.log('STDERR:', result.stderr);
  }
  
  return result;
}

/**
 * Clean up unnecessary installations
 */
async function cleanupUnnecessaryPackages(publicIp, keyFile) {
  console.log('\n🧹 Cleaning up unnecessary packages and installations...');
  
  const cleanupCommand = `
    set -e
    echo "=== Stopping unnecessary services ==="
    pkill -f "extract-cookies-streaming" 2>/dev/null || true
    pkill -f "canvas-wrapper-streaming" 2>/dev/null || true
    pkill -f "streaming" 2>/dev/null || true
    sleep 2
    
    echo "=== Removing unnecessary directories ==="
    rm -rf ~/canvas-wrapper-streaming 2>/dev/null || true
    rm -rf ~/.nvm 2>/dev/null || true
    rm -rf ~/node_modules 2>/dev/null || true
    rm -rf /tmp/node* 2>/dev/null || true
    rm -rf /tmp/npm* 2>/dev/null || true
    
    echo "=== Cleaning up package manager cache ==="
    if command -v yum &> /dev/null; then
      sudo yum clean all 2>/dev/null || true
    elif command -v apt-get &> /dev/null; then
      sudo apt-get clean 2>/dev/null || true
    fi
    
    echo "=== Removing old log files ==="
    find ~ -name "*.log" -type f -mtime +7 -delete 2>/dev/null || true
    rm -f /tmp/extraction.log /tmp/full-extraction.log 2>/dev/null || true
    
    echo "✅ Cleanup complete"
  `;
  
  const result = await executeCommand(publicIp, cleanupCommand, keyFile, 60000);
  console.log(result.stdout);
  if (result.stderr && !result.stderr.includes('No such file')) {
    console.log('STDERR:', result.stderr);
  }
  
  return result;
}

/**
 * Ensure proper Node.js installation (16.x for Amazon Linux 2, 18.x for Ubuntu)
 */
async function ensureNodeJs(publicIp, keyFile) {
  console.log('\n📦 Ensuring Node.js is properly installed...');
  
  const nodeSetupCommand = `
    set -e
    echo "=== Checking current Node.js installation ==="
    NODE_VERSION=$(node --version 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1 || echo "0")
    echo "Current Node.js major version: $NODE_VERSION"
    
    # Detect OS
    if [ -f /etc/os-release ]; then
      . /etc/os-release
      OS=$ID
    else
      OS="amzn"
    fi
    
    echo "Detected OS: $OS"
    
    if command -v yum &> /dev/null; then
      # Amazon Linux 2 - Use Node.js 16.x (compatible with glibc 2.26)
      if [ "$NODE_VERSION" != "16" ] || ! command -v node &> /dev/null; then
        echo "Installing Node.js 16.x for Amazon Linux 2..."
        
        # Remove old installations
        sudo rm -f /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx 2>/dev/null || true
        sudo rm -rf /usr/local/lib/node_modules 2>/dev/null || true
        
        # Install Node.js 16 from pre-built binary
        cd /tmp
        wget -q https://nodejs.org/dist/v16.20.2/node-v16.20.2-linux-x64.tar.xz
        tar -xf node-v16.20.2-linux-x64.tar.xz
        sudo cp -r node-v16.20.2-linux-x64/* /usr/local/
        sudo ln -sf /usr/local/bin/node /usr/bin/node 2>/dev/null || true
        sudo ln -sf /usr/local/bin/npm /usr/bin/npm 2>/dev/null || true
        rm -rf node-v16.20.2-linux-x64*
        cd ~
        
        echo "✅ Node.js 16.x installed"
      else
        echo "✅ Node.js 16.x already installed"
      fi
      
    elif command -v apt-get &> /dev/null; then
      # Ubuntu - Use Node.js 18.x
      if [ "$NODE_VERSION" -lt 18 ] || ! command -v node &> /dev/null; then
        echo "Installing Node.js 18.x for Ubuntu..."
        
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
        sudo ln -sf "$(which node)" /usr/local/bin/node 2>/dev/null || true
        sudo ln -sf "$(which npm)" /usr/local/bin/npm 2>/dev/null || true
        
        echo "✅ Node.js 18.x installed"
      else
        echo "✅ Node.js 18.x already installed"
      fi
    fi
    
    echo ""
    echo "=== Verification ==="
    echo "Node.js: $(node --version)"
    echo "npm: $(npm --version)"
  `;
  
  const result = await executeCommand(publicIp, nodeSetupCommand, keyFile, 300000);
  console.log(result.stdout);
  if (result.stderr && !result.stderr.includes('No such file')) {
    console.log('STDERR:', result.stderr);
  }
  
  return result;
}

/**
 * Ensure Chrome/Chromium is installed
 */
async function ensureChrome(publicIp, keyFile) {
  console.log('\n🌐 Ensuring Chrome/Chromium is installed...');
  
  const chromeSetupCommand = `
    set -e
    echo "=== Checking Chrome/Chromium installation ==="
    
    if command -v google-chrome &> /dev/null || command -v chromium &> /dev/null || command -v chromium-browser &> /dev/null; then
      echo "✅ Chrome/Chromium already installed"
      google-chrome --version 2>/dev/null || chromium --version 2>/dev/null || chromium-browser --version 2>/dev/null
    else
      echo "Installing Chrome/Chromium..."
      
      if command -v yum &> /dev/null; then
        # Amazon Linux 2
        sudo yum install -y chromium
        echo "✅ Chromium installed"
      elif command -v apt-get &> /dev/null; then
        # Ubuntu
        wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
        echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
        sudo apt-get update -y
        sudo apt-get install -y google-chrome-stable
        echo "✅ Google Chrome installed"
      fi
    fi
  `;
  
  const result = await executeCommand(publicIp, chromeSetupCommand, keyFile, 300000);
  console.log(result.stdout);
  if (result.stderr && !result.stderr.includes('No such file')) {
    console.log('STDERR:', result.stderr);
  }
  
  return result;
}

/**
 * Ensure Xvfb is installed
 */
async function ensureXvfb(publicIp, keyFile) {
  console.log('\n🖥️  Ensuring Xvfb is installed...');
  
  const xvfbSetupCommand = `
    set -e
    echo "=== Checking Xvfb installation ==="
    
    if command -v Xvfb &> /dev/null; then
      echo "✅ Xvfb already installed"
    else
      echo "Installing Xvfb..."
      
      if command -v yum &> /dev/null; then
        # Amazon Linux 2
        sudo yum install -y xorg-x11-server-Xvfb xorg-x11-xauth xorg-x11-apps
        echo "✅ Xvfb installed"
      elif command -v apt-get &> /dev/null; then
        # Ubuntu
        sudo apt-get install -y xvfb x11-apps x11-xserver-utils
        echo "✅ Xvfb installed"
      fi
    fi
  `;
  
  const result = await executeCommand(publicIp, xvfbSetupCommand, keyFile, 120000);
  console.log(result.stdout);
  if (result.stderr && !result.stderr.includes('No such file')) {
    console.log('STDERR:', result.stderr);
  }
  
  return result;
}

/**
 * Ensure Canvas-Wrapper directory exists and is properly set up
 */
async function ensureCanvasWrapper(publicIp, keyFile) {
  console.log('\n📁 Ensuring Canvas-Wrapper directory is set up...');
  
  const setupCommand = `
    set -e
    echo "=== Checking Canvas-Wrapper directory ==="
    
    if [ ! -d ~/Canvas-Wrapper ]; then
      echo "⚠️  Canvas-Wrapper directory not found"
      echo "Creating directory structure..."
      mkdir -p ~/Canvas-Wrapper/data/auth
      mkdir -p ~/Canvas-Wrapper/storage/datasets
      echo "✅ Directory structure created"
      echo "⚠️  NOTE: You need to sync the project code to ~/Canvas-Wrapper"
    else
      echo "✅ Canvas-Wrapper directory exists"
      
      # Check if it's a git repository
      if [ -d ~/Canvas-Wrapper/.git ]; then
        echo "✅ Git repository detected"
      else
        echo "⚠️  Not a git repository - code may need to be synced"
      fi
      
      # Ensure required directories exist
      mkdir -p ~/Canvas-Wrapper/data/auth
      mkdir -p ~/Canvas-Wrapper/storage/datasets
      echo "✅ Required subdirectories ensured"
    fi
  `;
  
  const result = await executeCommand(publicIp, setupCommand, keyFile, 30000);
  console.log(result.stdout);
  if (result.stderr && !result.stderr.includes('No such file')) {
    console.log('STDERR:', result.stderr);
  }
  
  return result;
}

/**
 * Sync code to AWS instance using rsync
 */
async function syncCodeToInstance(publicIp, keyFile) {
  const localPath = path.join(__dirname, '..');
  const remotePath = '~/Canvas-Wrapper';
  
  console.log(`\n📤 Syncing code to AWS instance...`);
  console.log(`   Local: ${localPath}`);
  console.log(`   Remote: ${remotePath}`);
  
  const sshUser = process.env.AWS_SSH_USER || 'ec2-user';
  const { spawn } = require('child_process');
  
  return new Promise((resolve) => {
    // Exclude node_modules, storage, .git, and other large/unnecessary directories
    const rsyncCommand = [
      '-avz',
      '--delete',
      '--exclude', 'node_modules',
      '--exclude', 'storage',
      '--exclude', '.git',
      '--exclude', '.env',
      '--exclude', '*.log',
      '--exclude', '*.pem',
      '--exclude', '.DS_Store',
      '--exclude', 'data/mappings',
      '-e', `ssh -i "${keyFile}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`,
      `${localPath}/`,
      `${sshUser}@${publicIp}:${remotePath}/`
    ];
    
    const rsync = spawn('rsync', rsyncCommand, {
      stdio: 'inherit'
    });
    
    rsync.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Code synced successfully');
        resolve({ success: true });
      } else {
        console.error(`❌ Code sync failed with exit code ${code}`);
        resolve({ success: false, exitCode: code });
      }
    });
    
    rsync.on('error', (error) => {
      console.error(`❌ Code sync error: ${error.message}`);
      resolve({ success: false, error: error.message });
    });
  });
}

/**
 * Install npm dependencies
 */
async function installDependencies(publicIp, keyFile) {
  console.log('\n📦 Installing npm dependencies...');
  
  const installCommand = `
    cd ~/Canvas-Wrapper
    if [ -f package.json ]; then
      echo "Installing dependencies..."
      npm install --production --no-audit --no-fund
      echo "✅ Dependencies installed"
    else
      echo "❌ package.json not found - code may not be synced"
      exit 1
    fi
  `;
  
  const result = await executeCommand(publicIp, installCommand, keyFile, 600000);
  console.log(result.stdout);
  if (result.stderr && !result.stderr.includes('No such file')) {
    console.log('STDERR:', result.stderr);
  }
  
  return result;
}

/**
 * Verify server is ready for extraction
 */
async function verifyReadiness(publicIp, keyFile) {
  console.log('\n✅ Verifying server readiness...');
  
  const verifyCommand = `
    echo "=== System Requirements ==="
    echo -n "Node.js: " && (node --version || echo "❌ Not found")
    echo -n "npm: " && (npm --version || echo "❌ Not found")
    echo -n "Chrome: " && (google-chrome --version 2>/dev/null || chromium --version 2>/dev/null || echo "❌ Not found")
    echo -n "Xvfb: " && (which Xvfb && echo "✅ Installed" || echo "❌ Not found")
    echo ""
    echo "=== Canvas-Wrapper Setup ==="
    if [ -d ~/Canvas-Wrapper ]; then
      echo "✅ Canvas-Wrapper directory exists"
      if [ -f ~/Canvas-Wrapper/package.json ]; then
        echo "✅ package.json found"
        if [ -d ~/Canvas-Wrapper/node_modules ]; then
          echo "✅ node_modules exists"
          echo -n "   Dependencies: " && (cd ~/Canvas-Wrapper && npm list --depth=0 2>/dev/null | wc -l || echo "unknown") && echo " packages"
        else
          echo "⚠️  node_modules not found"
        fi
      else
        echo "⚠️  package.json not found - project code may not be synced"
      fi
    else
      echo "❌ Canvas-Wrapper directory not found"
    fi
    echo ""
    echo "=== Disk Space ==="
    df -h / | tail -1
  `;
  
  const result = await executeCommand(publicIp, verifyCommand, keyFile, 30000);
  console.log(result.stdout);
  if (result.stderr && !result.stderr.includes('No such file')) {
    console.log('STDERR:', result.stderr);
  }
  
  return result;
}

/**
 * Main execution
 */
async function main() {
  try {
    console.log('🧹 AWS Server Cleanup and Setup');
    console.log('='.repeat(60));
    console.log(`   Instance ID: ${AWS_INSTANCE_ID}`);
    console.log(`   Region: ${AWS_REGION}`);
    console.log('='.repeat(60));
    
    if (!fs.existsSync(AWS_KEY_FILE)) {
      console.error(`❌ Error: AWS key file not found: ${AWS_KEY_FILE}`);
      console.error('   Please set AWS_KEY_FILE environment variable');
      process.exit(1);
    }
    
    // Step 1: Ensure instance is running
    console.log('\n📋 Step 1: Starting AWS instance...');
    const instanceResult = await ensureInstanceReady(AWS_INSTANCE_ID, null, AWS_KEY_FILE);
    
    if (!instanceResult.success) {
      console.error(`❌ Failed to start instance: ${instanceResult.error}`);
      process.exit(1);
    }
    
    const { publicIp } = instanceResult;
    console.log(`✅ Instance is running at ${publicIp}`);
    
    // Step 2: Check current state
    await checkCurrentState(publicIp, AWS_KEY_FILE);
    
    // Step 3: Clean up unnecessary packages
    await cleanupUnnecessaryPackages(publicIp, AWS_KEY_FILE);
    
    // Step 4: Ensure Node.js is properly installed
    await ensureNodeJs(publicIp, AWS_KEY_FILE);
    
    // Step 5: Ensure Chrome/Chromium is installed
    await ensureChrome(publicIp, AWS_KEY_FILE);
    
    // Step 6: Ensure Xvfb is installed
    await ensureXvfb(publicIp, AWS_KEY_FILE);
    
    // Step 7: Ensure Canvas-Wrapper directory structure
    await ensureCanvasWrapper(publicIp, AWS_KEY_FILE);
    
    // Step 8: Sync code to instance
    const codeSyncResult = await syncCodeToInstance(publicIp, AWS_KEY_FILE);
    if (!codeSyncResult.success) {
      console.log('⚠️  Code sync had issues, but continuing...');
    }
    
    // Step 9: Install dependencies
    const installResult = await installDependencies(publicIp, AWS_KEY_FILE);
    if (!installResult.success) {
      console.log('⚠️  Dependency installation had issues');
    }
    
    // Step 10: Verify readiness
    await verifyReadiness(publicIp, AWS_KEY_FILE);
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Server cleanup and setup complete!');
    console.log('='.repeat(60));
    console.log('\n📋 Next steps:');
    console.log('   1. Sync cookies: npm run aws:update (or manually sync cookies)');
    console.log('   2. Run extraction: npm run aws:extract');
    console.log('');
    
  } catch (error) {
    console.error('\n❌ Error during cleanup:', error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Cleanup failed:', error.message);
  process.exit(1);
});





