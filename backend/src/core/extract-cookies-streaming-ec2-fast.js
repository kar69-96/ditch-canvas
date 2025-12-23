#!/usr/bin/env node
/**
 * Fast-start script for streaming cookie extraction on EC2
 * Assumes instance is always running and dependencies are already installed
 * Skips all installation checks for minimal startup time
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

// Helper to add timeout to execAsync
function execWithTimeout(command, timeoutMs = 30000) {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  
  return Promise.race([
    execAsync(command),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Command timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

// Get EC2 public IP (assumes instance is running)
async function getEC2PublicIP() {
  try {
    // First, get instance state and details
    console.log(`🔍 Checking instance ${AWS_INSTANCE_ID}...`);
    
    const instanceQuery = `aws ec2 describe-instances --instance-ids ${AWS_INSTANCE_ID} --region ${AWS_REGION} --query 'Reservations[0].Instances[0].[State.Name,PublicIpAddress,PrivateIpAddress,PublicDnsName]' --output text`;
    
    let instanceInfo;
    try {
      const { stdout } = await execWithTimeout(instanceQuery, 15000);
      const parts = stdout.trim().split('\t');
      instanceInfo = {
        state: parts[0] || 'unknown',
        publicIp: parts[1] || null,
        privateIp: parts[2] || null,
        publicDns: parts[3] || null
      };
    } catch (queryError) {
      // Try a simpler query to see if instance exists
      try {
        const { stdout: stateStdout } = await execWithTimeout(
          `aws ec2 describe-instances --instance-ids ${AWS_INSTANCE_ID} --region ${AWS_REGION} --query 'Reservations[0].Instances[0].State.Name' --output text`,
          15000
        );
        const state = stateStdout.trim();
        throw new Error(`Instance found but query failed. State: ${state || 'unknown'}`);
      } catch (stateError) {
        if (stateError.message.includes('does not exist') || stateError.message.includes('InvalidInstanceID')) {
          throw new Error(`Instance ${AWS_INSTANCE_ID} does not exist in region ${AWS_REGION}`);
        }
        throw new Error(`Failed to query instance: ${queryError.message}`);
      }
    }
    
    console.log(`   State: ${instanceInfo.state}`);
    
    // Check instance state
    if (instanceInfo.state === 'stopped' || instanceInfo.state === 'stopping') {
      throw new Error(`Instance is ${instanceInfo.state}. Please start it first with: aws ec2 start-instances --instance-ids ${AWS_INSTANCE_ID} --region ${AWS_REGION}`);
    }
    
    if (instanceInfo.state === 'pending') {
      throw new Error('Instance is still starting. Please wait a few minutes and try again.');
    }
    
    if (instanceInfo.state !== 'running') {
      throw new Error(`Instance is in ${instanceInfo.state} state. Expected 'running'.`);
    }
    
    // Check for public IP
    if (!instanceInfo.publicIp || instanceInfo.publicIp === 'None' || instanceInfo.publicIp === 'null') {
      console.error('   ⚠️  Instance is running but has no public IP address.');
      console.error('   This usually means:');
      console.error('   1. Instance is in a private subnet without NAT Gateway');
      console.error('   2. Instance was launched without public IP assignment');
      console.error(`   Private IP: ${instanceInfo.privateIp || 'N/A'}`);
      console.error(`   Public DNS: ${instanceInfo.publicDns || 'N/A'}`);
      throw new Error('Instance does not have a public IP address. Cannot connect via SSH.');
    }
    
    return instanceInfo.publicIp;
  } catch (error) {
    console.error('❌ Error getting EC2 IP:', error.message);
    console.error(`   Instance ID: ${AWS_INSTANCE_ID}`);
    console.error(`   Region: ${AWS_REGION}`);
    console.error('\n💡 Troubleshooting:');
    console.error('   1. Verify instance exists: aws ec2 describe-instances --instance-ids ' + AWS_INSTANCE_ID);
    console.error('   2. Check instance state: aws ec2 describe-instance-status --instance-ids ' + AWS_INSTANCE_ID);
    console.error('   3. Start instance if stopped: aws ec2 start-instances --instance-ids ' + AWS_INSTANCE_ID);
    console.error('   4. Verify AWS CLI is configured: aws sts get-caller-identity');
    process.exit(1);
  }
}

// Import shared cookie sync utility
const { downloadCookiesFromEC2 } = require('./ec2-cookie-sync');

// Fast start: Just copy script and start server (assumes everything is installed)
async function fastStartServer(publicIp) {
  return new Promise((resolve, reject) => {
    if (!publicIp || publicIp === 'None' || publicIp === 'null') {
      reject(new Error('Invalid EC2 public IP address'));
      return;
    }

    console.log('⚡ Fast-start: Copying script and starting server...');
    
    const streamingScriptPath = path.join(__dirname, 'extract-cookies-streaming.js');
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    (async () => {
      try {
        // Verify script exists locally
        if (!fs.existsSync(streamingScriptPath)) {
          reject(new Error(`Streaming script not found: ${streamingScriptPath}`));
          return;
        }

        // Test SSH connection first
        console.log('🔌 Testing SSH connection...');
        try {
          await execWithTimeout(
            `ssh -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 ${AWS_SSH_USER}@${publicIp} "echo 'SSH_OK'"`,
            15000
          );
          console.log('✅ SSH connection successful');
        } catch (sshError) {
          reject(new Error(`SSH connection failed: ${sshError.message}. Is the instance running and accessible?`));
          return;
        }

        // Create directory (idempotent)
        console.log('📁 Creating directory...');
        try {
          await execWithTimeout(
            `ssh -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 ${AWS_SSH_USER}@${publicIp} "mkdir -p ~/canvas-wrapper-streaming"`,
            15000
          );
        } catch (error) {
          reject(new Error(`Failed to create directory: ${error.message}`));
          return;
        }
        
        // Copy script
        console.log('📤 Copying streaming script...');
        try {
          await execWithTimeout(
            `scp -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 "${streamingScriptPath}" ${AWS_SSH_USER}@${publicIp}:~/canvas-wrapper-streaming/extract-cookies-streaming.js`,
            30000
          );
          console.log('✅ Script copied successfully');
        } catch (error) {
          reject(new Error(`Failed to copy script: ${error.message}`));
          return;
        }
        
        // Quick start script (assumes Xvfb and Chrome are already installed and running)
        const startScript = `ssh -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 ${AWS_SSH_USER}@${publicIp} <<'REMOTE_EOF'
cd ~/canvas-wrapper-streaming
export DISPLAY=:99

# Ensure Xvfb is running (quick check, don't install)
if ! pgrep -f 'Xvfb :99' > /dev/null; then
  echo "⚠️  Starting Xvfb..."
  Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset > /tmp/xvfb.log 2>&1 &
  sleep 2
fi

# Kill existing server if running
pkill -f extract-cookies-streaming 2>/dev/null || true
sleep 1

# Start server
nohup node extract-cookies-streaming.js > streaming.log 2>&1 &
sleep 2

# Verify it started
if pgrep -f extract-cookies-streaming > /dev/null; then
  echo "SERVER_STARTED"
else
  echo "SERVER_FAILED"
  tail -20 streaming.log 2>/dev/null || echo "No log file found"
  exit 1
fi
REMOTE_EOF`;

        console.log('🚀 Starting server...');
        const child = spawn('sh', ['-c', startScript], {
          stdio: ['inherit', 'pipe', 'pipe']
        });

        // Add timeout to prevent hanging
        const startupTimeout = setTimeout(() => {
          child.kill();
          reject(new Error('Server startup timed out after 60 seconds. Check instance connectivity and logs.'));
        }, 60000);

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
          clearTimeout(startupTimeout);
          
          // Quick verification
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          try {
            const checkResult = await execWithTimeout(
              `ssh -i "${AWS_KEY_FILE}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 ${AWS_SSH_USER}@${publicIp} "pgrep -f extract-cookies-streaming"`,
              10000
            );
            if (checkResult.stdout && checkResult.stdout.trim()) {
              console.log('✅ Server started successfully (PID:', checkResult.stdout.trim() + ')');
              resolve();
              return;
            }
          } catch (e) {
            // Check failed - continue to check output
          }
          
          if (output.includes('SERVER_STARTED')) {
            console.log('✅ Server started successfully');
            resolve();
          } else if (output.includes('SERVER_FAILED')) {
            reject(new Error('Server failed to start - check logs on EC2: ~/canvas-wrapper-streaming/streaming.log'));
          } else if (code === 0) {
            // Assume success if exit code is 0
            console.log('✅ Server should be running');
            resolve();
          } else {
            reject(new Error(`Startup failed with code ${code}. Output: ${output.substring(0, 500)}`));
          }
        });
      } catch (error) {
        console.error('❌ Error during fast-start:', error.message);
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
  console.log('⚡ Fast-Start: Canvas Cookie Extraction (EC2 Streaming)');
  console.log('═══════════════════════════════════════════════════\n');
  console.log('📋 Assumes:');
  console.log('   - EC2 instance is running');
  console.log('   - Dependencies are installed');
  console.log('   - Chrome is installed');
  console.log('   - Xvfb can be started if needed\n');

  // Check key file
  if (!fs.existsSync(AWS_KEY_FILE)) {
    console.error(`❌ Error: AWS key file not found: ${AWS_KEY_FILE}`);
    console.error('   Please set AWS_KEY_FILE environment variable');
    process.exit(1);
  }

  // Get EC2 IP (assumes running)
  console.log(`📡 Getting EC2 instance IP (${AWS_INSTANCE_ID})...`);
  const publicIp = await getEC2PublicIP();
  console.log(`✅ EC2 Public IP: ${publicIp}\n`);

  // Fast start server
  try {
    await fastStartServer(publicIp);
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    console.error('\n💡 If this is the first time, run: npm run auth:extract-cookies:streaming:setup');
    process.exit(1);
  }

  // Open browser
  const url = `http://${publicIp}:${STREAMING_PORT}`;
  openBrowser(url);

  console.log('\n✅ Fast-start complete!');
  console.log('═══════════════════════════════════════════════════');
  console.log(`📊 Server URL: ${url}`);
  console.log(`🛑 To stop: ssh -i ${AWS_KEY_FILE} ${AWS_SSH_USER}@${publicIp} "pkill -f extract-cookies-streaming"`);
  console.log('═══════════════════════════════════════════════════\n');
  
  // Stream logs from EC2 in real-time
  console.log('📋 Streaming server logs:\n');
  console.log('─'.repeat(60));
  
  let extractionCompleted = false;
  let exitTimeout = null;
  
  // Function to check if server is still running and exit if not
  async function checkServerAndExit() {
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
        clearInterval(serverCheckInterval);
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
    await checkServerAndExit();
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
            await checkServerAndExit();
            
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
        await checkServerAndExit();
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
