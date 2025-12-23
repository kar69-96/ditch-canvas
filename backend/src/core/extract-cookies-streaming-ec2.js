#!/usr/bin/env node
/**
 * Wrapper script to start streaming server on EC2 and open browser
 * This script handles SSH connection, server startup, and browser opening
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
const STREAMING_PORT = process.env.STREAMING_PORT || 3002;
const AWS_SSH_USER = process.env.AWS_SSH_USER || 'ec2-user';

// Import shared cookie sync utility
const { downloadCookiesFromEC2 } = require('./ec2-cookie-sync');

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
      // Try to start the instance if it's stopped
      console.log('⚠️  Instance may be stopped. Attempting to start...');
      await execAsync(`aws ec2 start-instances --instance-ids ${AWS_INSTANCE_ID} --region ${AWS_REGION}`);
      
      // Wait for instance to be running
      console.log('⏳ Waiting for instance to start...');
      await execAsync(`aws ec2 wait instance-running --instance-ids ${AWS_INSTANCE_ID} --region ${AWS_REGION}`);
      
      // Get IP again
      const { stdout: newStdout } = await execAsync(
        `aws ec2 describe-instances --instance-ids ${AWS_INSTANCE_ID} --region ${AWS_REGION} --query 'Reservations[0].Instances[0].PublicIpAddress' --output text`
      );
      const newIp = newStdout.trim();
      
      if (!newIp || newIp === 'None' || newIp === 'null') {
        throw new Error('Instance does not have a public IP address');
      }
      
      return newIp;
    }
    
    return ip;
  } catch (error) {
    console.error('❌ Error getting EC2 IP:', error.message);
    console.error('   Make sure AWS CLI is configured and instance is running');
    process.exit(1);
  }
}

// Ensure security group allows port 3002
async function ensureSecurityGroupPort(instanceId) {
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    // Get security group ID
    const { stdout: sgId } = await execAsync(
      `aws ec2 describe-instances --instance-ids ${instanceId} --region ${AWS_REGION} --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' --output text`
    );
    const securityGroupId = sgId.trim();
    
    if (!securityGroupId) {
      console.log('⚠️  Could not determine security group, skipping port check');
      return;
    }
    
    // Check if port 3002 is already open
    const { stdout: portCheck } = await execAsync(
      `aws ec2 describe-security-groups --group-ids ${securityGroupId} --region ${AWS_REGION} --query 'SecurityGroups[0].IpPermissions[?FromPort==\`3002\`]' --output json`
    ).catch(() => ({ stdout: '[]' }));
    
    const rules = JSON.parse(portCheck);
    if (rules && rules.length > 0) {
      console.log('✅ Port 3002 is already open in security group');
      return;
    }
    
    // Open port 3002
    console.log('🔓 Opening port 3002 in security group...');
    await execAsync(
      `aws ec2 authorize-security-group-ingress --group-id ${securityGroupId} --protocol tcp --port 3002 --cidr 0.0.0.0/0 --region ${AWS_REGION}`
    );
    console.log('✅ Port 3002 opened in security group');
  } catch (error) {
    console.log('⚠️  Could not configure security group:', error.message);
    console.log('   You may need to manually open port 3002 in the EC2 security group');
  }
}

// Deploy and start server on EC2
async function startServerOnEC2(publicIp, instanceId) {
  return new Promise((resolve, reject) => {
    if (!publicIp || publicIp === 'None' || publicIp === 'null') {
      reject(new Error('Invalid EC2 public IP address'));
      return;
    }

    console.log('🚀 Deploying and starting streaming server on EC2...');
    
    // Ensure security group allows port 3002 (async, don't wait)
    ensureSecurityGroupPort(instanceId).catch(() => {
      // Ignore errors, continue anyway
    });
    
    const streamingScriptPath = path.join(__dirname, 'extract-cookies-streaming.js');
    const packageJsonPath = path.join(__dirname, '..', 'package.json');
    
    // First, deploy the script and ensure directory exists
    const deployCommand = `mkdir -p ~/canvas-wrapper-streaming && echo "Directory created"`;
    
    // Then copy the script
    const scpCommand = `scp -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "${streamingScriptPath}" ${AWS_SSH_USER}@${publicIp}:~/canvas-wrapper-streaming/extract-cookies-streaming.js`;
    
    // Then start the server
    const sshCommand = `ssh -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${AWS_SSH_USER}@${publicIp} <<'REMOTE_EOF'
cd ~/canvas-wrapper-streaming
export DISPLAY=:99
pkill -f extract-cookies-streaming 2>/dev/null
sleep 2
nohup node extract-cookies-streaming.js > streaming.log 2>&1 &
sleep 3
pgrep -f extract-cookies-streaming && echo "SERVER_STARTED" || echo "SERVER_FAILED"
REMOTE_EOF`;

    // Run deployment steps sequentially
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    (async () => {
      try {
        // Create directory
        console.log('📁 Creating directory on EC2...');
        await execAsync(`ssh -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${AWS_SSH_USER}@${publicIp} "${deployCommand}"`);
        
        // Copy script
        console.log('📤 Copying streaming script...');
        await execAsync(scpCommand);
        
        // Copy minimal package.json for streaming (compatible with Node 16/20)
        const streamingPackagePath = path.join(__dirname, '..', 'aws', 'streaming-package.json');
        console.log('📋 Copying package.json...');
        if (fs.existsSync(streamingPackagePath)) {
          try {
            await execAsync(`scp -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "${streamingPackagePath}" ${AWS_SSH_USER}@${publicIp}:~/canvas-wrapper-streaming/package.json`);
            console.log('✅ Copied streaming package.json');
          } catch (e) {
            console.log('⚠️  Failed to copy streaming package.json, trying regular package.json...');
            // Try regular package.json as fallback
            if (fs.existsSync(packageJsonPath)) {
              await execAsync(`scp -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "${packageJsonPath}" ${AWS_SSH_USER}@${publicIp}:~/canvas-wrapper-streaming/package.json`);
              console.log('✅ Copied regular package.json');
            }
          }
        } else if (fs.existsSync(packageJsonPath)) {
          await execAsync(`scp -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "${packageJsonPath}" ${AWS_SSH_USER}@${publicIp}:~/canvas-wrapper-streaming/package.json`);
          console.log('✅ Copied package.json');
        } else {
          // Create a minimal package.json inline
          const minimalPackage = JSON.stringify({
            name: "canvas-wrapper-streaming",
            version: "1.0.0",
            dependencies: {
              "express": "^4.18.2",
              "socket.io": "^4.5.4",
              "playwright-core": "1.40.1",
              "dotenv": "^16.6.1"
            }
          }, null, 2);
          const tempPackagePath = path.join(__dirname, '..', '..', 'temp-streaming-package.json');
          fs.writeFileSync(tempPackagePath, minimalPackage);
          await execAsync(`scp -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "${tempPackagePath}" ${AWS_SSH_USER}@${publicIp}:~/canvas-wrapper-streaming/package.json`);
          fs.unlinkSync(tempPackagePath);
          console.log('✅ Created minimal package.json');
        }
        
        // Check if dependencies are already installed (skip if node_modules exists)
        console.log('🔍 Checking if dependencies are installed...');
        const depsCheck = await execAsync(`ssh -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${AWS_SSH_USER}@${publicIp} "test -d ~/canvas-wrapper-streaming/node_modules && echo 'INSTALLED' || echo 'NOT_INSTALLED'"`).catch(() => ({ stdout: 'NOT_INSTALLED' }));
        
        if (depsCheck.stdout && depsCheck.stdout.includes('INSTALLED')) {
          console.log('✅ Dependencies already installed, skipping npm install');
        } else {
          console.log('📦 Installing dependencies...');
          const installResult = await execAsync(`ssh -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${AWS_SSH_USER}@${publicIp} "cd ~/canvas-wrapper-streaming && npm install --production --no-audit --no-fund 2>&1"`);
          if (installResult.stdout) {
            const output = installResult.stdout;
            if (output.includes('added') || output.includes('up to date')) {
              console.log('✅ Dependencies installed');
            } else {
              console.log('⚠️  Installation output:', output.split('\n').slice(-3).join('\n'));
            }
          }
        }
        
        // Check if Xvfb is installed, only install if missing
        console.log('🔍 Checking for Xvfb...');
        const xvfbCheck = await execAsync(`ssh -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${AWS_SSH_USER}@${publicIp} "command -v Xvfb > /dev/null && echo 'INSTALLED' || echo 'NOT_INSTALLED'"`).catch(() => ({ stdout: 'NOT_INSTALLED' }));
        
        if (xvfbCheck.stdout && xvfbCheck.stdout.includes('INSTALLED')) {
          console.log('✅ Xvfb already installed');
        } else {
          console.log('🖥️  Installing Xvfb...');
          const xvfbInstall = `
if command -v dnf > /dev/null 2>&1; then
  sudo dnf install -y xorg-x11-server-Xvfb 2>&1 | tail -2
elif command -v yum > /dev/null 2>&1; then
  sudo yum install -y xorg-x11-server-Xvfb 2>&1 | tail -2
elif command -v apt-get > /dev/null 2>&1; then
  sudo apt-get update -y 2>&1 | tail -1
  sudo apt-get install -y xvfb 2>&1 | tail -2
fi
`.trim();
          try {
            await execAsync(`ssh -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${AWS_SSH_USER}@${publicIp} "${xvfbInstall}"`);
            console.log('✅ Xvfb installed');
          } catch (e) {
            console.log('⚠️  Xvfb installation had issues:', e.message);
          }
        }
        
        // Start Xvfb (always try to start, it's idempotent)
        console.log('🖥️  Starting Xvfb...');
        const xvfbStart = `
pkill -f "Xvfb :99" 2>/dev/null || true
sleep 1
Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset > /tmp/xvfb.log 2>&1 &
sleep 3
if pgrep -f 'Xvfb :99' > /dev/null; then
  echo "Xvfb is running"
else
  echo "Xvfb failed to start"
  cat /tmp/xvfb.log 2>/dev/null | tail -3
  exit 1
fi
`.trim();
        try {
          const xvfbResult = await execAsync(`ssh -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${AWS_SSH_USER}@${publicIp} "${xvfbStart}"`);
          if (xvfbResult.stdout && xvfbResult.stdout.includes('Xvfb is running')) {
            console.log('✅ Xvfb is running');
          } else {
            console.log('⚠️  Xvfb status unclear:', xvfbResult.stdout);
          }
        } catch (e) {
          console.log('⚠️  Xvfb startup had issues:', e.message);
          // Continue anyway - the script will fail with a better error if Xvfb isn't working
        }
        
        // Check for Chrome/Chromium, only install if missing
        console.log('🔍 Checking for Chrome/Chromium...');
        const chromeCheck = await execAsync(`ssh -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${AWS_SSH_USER}@${publicIp} "which google-chrome google-chrome-stable chromium chromium-browser 2>/dev/null | head -1"`).catch(() => ({ stdout: '' }));
        if (!chromeCheck.stdout || !chromeCheck.stdout.trim()) {
          console.log('📦 Installing Chrome...');
          // Install Chrome based on OS - use direct download for reliability
          const installScript = `
if command -v dnf &> /dev/null; then
  # Amazon Linux 2023 - download and install Chrome RPM directly
  cd /tmp
  wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm 2>&1 | tail -1
  sudo dnf install -y ./google-chrome-stable_current_x86_64.rpm 2>&1 | tail -3
  rm -f google-chrome-stable_current_x86_64.rpm
elif command -v yum &> /dev/null; then
  # Amazon Linux 2 - try chromium first, then Chrome
  sudo yum install -y chromium 2>&1 | tail -3 || (cd /tmp && wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm && sudo yum install -y ./google-chrome-stable_current_x86_64.rpm 2>&1 | tail -3 && rm -f google-chrome-stable_current_x86_64.rpm)
elif command -v apt-get &> /dev/null; then
  wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add - 2>&1
  echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
  sudo apt-get update -y 2>&1 | tail -2
  sudo apt-get install -y google-chrome-stable 2>&1 | tail -3
fi
which google-chrome google-chrome-stable chromium chromium-browser 2>/dev/null | head -1
`.trim();
          try {
            const installResult = await execAsync(`ssh -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${AWS_SSH_USER}@${publicIp} "${installScript}"`);
            if (installResult.stdout && installResult.stdout.trim()) {
              console.log('✅ Chrome installed at:', installResult.stdout.trim());
            } else {
              console.log('⚠️  Chrome installation completed (path not shown)');
            }
          } catch (e) {
            console.log('⚠️  Chrome installation may have failed, but continuing...');
          }
        } else {
          console.log('✅ Chrome found:', chromeCheck.stdout.trim());
        }
        
        // Start server
        console.log('🚀 Starting server...');
        const child = spawn('sh', ['-c', sshCommand], {
          stdio: ['inherit', 'pipe', 'pipe']
        });

        let output = '';
        child.stdout.on('data', (data) => {
          const text = data.toString();
          output += text;
          if (!text.includes('Pseudo-terminal') && !text.includes('Warning: Permanently added')) {
            process.stdout.write(text);
          }
        });

        child.stderr.on('data', (data) => {
          const text = data.toString();
          if (!text.includes('Pseudo-terminal') && !text.includes('Warning: Permanently added')) {
            process.stderr.write(text);
          }
        });

        child.on('close', async (code) => {
          // Wait a moment and check if server is actually running
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          try {
            const checkResult = await execAsync(`ssh -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${AWS_SSH_USER}@${publicIp} "pgrep -f extract-cookies-streaming"`);
            if (checkResult.stdout && checkResult.stdout.trim()) {
              console.log('✅ Server started successfully (PID:', checkResult.stdout.trim() + ')');
              resolve();
              return;
            }
          } catch (e) {
            // Check failed
          }
          
          // Check logs for errors
          try {
            const logCheck = await execAsync(`ssh -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${AWS_SSH_USER}@${publicIp} "tail -10 ~/canvas-wrapper-streaming/streaming.log 2>/dev/null | grep -E '(Error|error|started|running)' | tail -3"`);
            if (logCheck.stdout) {
              console.log('Recent logs:', logCheck.stdout);
            }
          } catch (e) {
            // Ignore log check errors
          }
          
          if (output.includes('SERVER_STARTED')) {
            console.log('✅ Server started successfully');
            resolve();
          } else if (output.includes('SERVER_FAILED')) {
            reject(new Error('Server failed to start - check logs on EC2'));
          } else if (code === 0) {
            // Even if we don't see SERVER_STARTED, if exit code is 0, assume it might be running
            console.log('⚠️  Server start status unclear - checking...');
            // Give it another moment
            await new Promise(resolve => setTimeout(resolve, 2000));
            try {
              const finalCheck = await execAsync(`ssh -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${AWS_SSH_USER}@${publicIp} "pgrep -f extract-cookies-streaming"`);
              if (finalCheck.stdout && finalCheck.stdout.trim()) {
                console.log('✅ Server is running');
                resolve();
              } else {
                reject(new Error('Server process not found'));
              }
            } catch (e) {
              reject(new Error('Server may not have started - check EC2 logs'));
            }
          } else {
            reject(new Error(`SSH command failed with code ${code}`));
          }
        });
      } catch (error) {
        reject(error);
      }
    })();
  });
}

// Open browser
function openBrowser(url) {
  const platform = process.platform;
  let command;

  if (platform === 'darwin') {
    command = `open "${url}"`;
  } else if (platform === 'linux') {
    command = `xdg-open "${url}"`;
  } else if (platform === 'win32') {
    command = `start "${url}"`;
  } else {
    console.log(`\n🌐 Open this URL in your browser: ${url}`);
    return;
  }

  setTimeout(() => {
    spawn('sh', ['-c', command], { stdio: 'ignore' });
    console.log(`\n🌐 Opening browser to: ${url}`);
  }, 2000);
}

// Main function
async function main() {
  console.log('🌐 Starting Canvas Cookie Extraction (EC2 Streaming)');
  console.log('═══════════════════════════════════════════════════\n');

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

  // Start server
  try {
    await startServerOnEC2(publicIp, AWS_INSTANCE_ID);
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }

  // Open browser
  const url = `http://${publicIp}:${STREAMING_PORT}`;
  openBrowser(url);

  console.log('\n✅ Setup complete!');
  console.log('═══════════════════════════════════════════════════');
  console.log(`📊 Server URL: ${url}`);
  console.log(`🛑 To stop: ssh -i ${AWS_KEY_FILE} ${AWS_SSH_USER}@${publicIp} "pkill -f extract-cookies-streaming"`);
  console.log('═══════════════════════════════════════════════════\n');
  
  // Stream logs from EC2 in real-time
  console.log('📋 Streaming server logs (cookie extraction progress will appear here):\n');
  console.log('─'.repeat(60));
  
  let extractionCompleted = false;
  let exitTimeout = null;
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  
  // Helper to add timeout to execAsync
  function execWithTimeout(command, timeoutMs = 30000) {
    return Promise.race([
      execAsync(command),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Command timed out after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
  }
  
  // Function to check if server is still running and download cookies if not
  async function checkServerAndDownloadCookies() {
    try {
      const checkResult = await execWithTimeout(
        `ssh -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 ${AWS_SSH_USER}@${publicIp} "pgrep -f extract-cookies-streaming"`,
        5000
      );
      // Server is still running
      return false;
    } catch (e) {
      // Server is not running - extraction likely completed
      if (!extractionCompleted) {
        extractionCompleted = true;
        console.log('\n\n✅ Extraction completed. Server has stopped.');
        console.log('─'.repeat(60));
        if (exitTimeout) clearTimeout(exitTimeout);
        logStream.kill();
        
        // Download cookies from EC2
        await downloadCookiesFromEC2(publicIp, AWS_KEY_FILE, AWS_SSH_USER);
        
        process.exit(0);
      }
      return true;
    }
  }
  
  // Periodically check if server is still running (every 5 seconds)
  const serverCheckInterval = setInterval(async () => {
    await checkServerAndDownloadCookies();
  }, 5000);
  
  const logStream = spawn('ssh', [
    '-i', AWS_KEY_FILE,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    `${AWS_SSH_USER}@${publicIp}`,
    'tail -f ~/canvas-wrapper-streaming/streaming.log'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  
  // Filter out SSH warnings and detect completion
  logStream.stdout.on('data', (data) => {
    const text = data.toString();
    // Filter out SSH warnings and Amazon Linux banner
    if (!text.includes('Pseudo-terminal') && 
        !text.includes('Warning: Permanently added') &&
        !text.includes('Amazon Linux') &&
        !text.includes('~\\_') &&
        !text.includes('~~') &&
        !text.includes('V~') &&
        !text.includes('_/') &&
        !text.includes('/m/')) {
      process.stdout.write(text);
      
      // Detect completion messages
      if (text.includes('completed successfully') || 
          text.includes('Cookie extraction completed') ||
          text.includes('Canvas cookie extraction completed')) {
        if (!extractionCompleted) {
          extractionCompleted = true;
          // Wait a moment for final logs, then download cookies and exit
          exitTimeout = setTimeout(async () => {
            console.log('\n\n✅ Extraction completed successfully!');
            console.log('─'.repeat(60));
            clearInterval(serverCheckInterval);
            
            // Download cookies from EC2 before exiting
            await downloadCookiesFromEC2(publicIp, AWS_KEY_FILE, AWS_SSH_USER);
            
            // Check if server stopped, if not wait a bit more
            await checkServerAndDownloadCookies();
            
            // If server check didn't exit, force exit after a short delay
            setTimeout(() => {
              logStream.kill();
              process.exit(0);
            }, 2000);
          }, 3000);
        }
      }
    }
  });
  
  logStream.stderr.on('data', (data) => {
    const text = data.toString();
    if (!text.includes('Pseudo-terminal') && !text.includes('Warning: Permanently added')) {
      process.stderr.write(text);
    }
  });
  
  logStream.on('close', async (code) => {
    clearInterval(serverCheckInterval);
    if (exitTimeout) clearTimeout(exitTimeout);
    if (code !== 0 && code !== null && !extractionCompleted) {
      console.log(`\n⚠️  Log stream ended (code: ${code})`);
    }
    if (!extractionCompleted) {
      // Log stream ended but extraction might still be running, check one more time
      setTimeout(async () => {
        // Try to download cookies even if we're not sure extraction completed
        await downloadCookiesFromEC2(publicIp, AWS_KEY_FILE, AWS_SSH_USER);
        await checkServerAndDownloadCookies();
        process.exit(0);
      }, 1000);
    }
  });
  
  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping log stream...');
    clearInterval(serverCheckInterval);
    if (exitTimeout) clearTimeout(exitTimeout);
    logStream.kill();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
