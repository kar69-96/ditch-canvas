#!/usr/bin/env node
/**
 * AWS Update Checker Runner
 * Runs the Canvas update checker on AWS EC2 instance
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

const { ensureInstanceReady, executeCommand, cleanup, waitForSSH } = require('./utils/aws-ec2-manager.js');

// Configuration
const AWS_INSTANCE_ID = process.env.AWS_INSTANCE_ID;
const AWS_KEY_FILE = process.env.AWS_KEY_FILE || path.join(__dirname, '..', 'Canvas-Wrapper.pem');
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

/**
 * Sync cookies to AWS instance
 */
async function syncCookiesToInstance(publicIp, keyFile) {
  const localCookiePath = path.join(__dirname, '..', 'data', 'auth', 'canvas-cookies.json');
  const remoteCookiePath = '~/Canvas-Wrapper/data/auth/canvas-cookies.json';
  const sshUser = process.env.AWS_SSH_USER || 'ec2-user';
  
  if (!fs.existsSync(localCookiePath)) {
    console.log('⚠️  Local cookie file not found, skipping sync');
    return { success: false, error: 'Local cookie file not found' };
  }
  
  console.log('\n📤 Syncing cookies to AWS instance...');
  
  return new Promise((resolve) => {
    // Ensure remote directory exists
    const mkdirCommand = `ssh -i "${keyFile}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${sshUser}@${publicIp} "mkdir -p ~/Canvas-Wrapper/data/auth"`;
    
    const { spawn } = require('child_process');
    const mkdir = spawn('sh', ['-c', mkdirCommand], { stdio: 'inherit' });
    
    mkdir.on('close', (code) => {
      if (code !== 0) {
        console.log('⚠️  Failed to create remote auth directory');
        resolve({ success: false, error: 'Failed to create remote directory' });
        return;
      }
      
      // Sync cookie file
      const rsyncCommand = [
        '-avz',
        '-e', `ssh -i "${keyFile}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`,
        localCookiePath,
        `${sshUser}@${publicIp}:${remoteCookiePath}`
      ];
      
      const rsync = spawn('rsync', rsyncCommand, { stdio: 'inherit' });
      
      rsync.on('close', (rsyncCode) => {
        if (rsyncCode === 0) {
          console.log('✅ Cookies synced successfully');
          resolve({ success: true });
        } else {
          console.error(`❌ Cookie sync failed with exit code ${rsyncCode}`);
          resolve({ success: false, exitCode: rsyncCode });
        }
      });
      
      rsync.on('error', (error) => {
        console.error(`❌ Cookie sync error: ${error.message}`);
        resolve({ success: false, error: error.message });
      });
    });
  });
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
  
  return new Promise((resolve, reject) => {
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
        reject({ success: false, exitCode: code });
      }
    });
    
    rsync.on('error', (error) => {
      console.error(`❌ Code sync error: ${error.message}`);
      reject({ success: false, error: error.message });
    });
  });
}

/**
 * Validate cookies on AWS instance
 */
async function validateCookies(publicIp, keyFile) {
  console.log('\n🔍 Validating cookies on AWS instance...');
  
  // Create a temporary validation script file to avoid quote escaping issues
  // Use absolute path to cookie file (in user's home directory)
  const validateScript = `const path = require('path');
const fs = require('fs');
const os = require('os');
const homeDir = os.homedir();
const cookieFile = path.join(homeDir, 'Canvas-Wrapper', 'data', 'auth', 'canvas-cookies.json');
if (!fs.existsSync(cookieFile)) {
  console.log('INVALID: Cookie file not found at ' + cookieFile);
  process.exit(1);
}
try {
  const data = JSON.parse(fs.readFileSync(cookieFile, 'utf8'));
  if (!data.cookies || !Array.isArray(data.cookies) || data.cookies.length === 0) {
    console.log('INVALID: No cookies in file');
    process.exit(1);
  }
  console.log('VALID: Cookies found (' + data.cookies.length + ' cookies)');
} catch (e) {
  console.log('INVALID: ' + e.message);
  process.exit(1);
}`;
  
  // Write script to temp file, execute it, then clean up
  // Use single quotes and escape properly for the heredoc
  const validateCommand = `cd ~/Canvas-Wrapper && cat > /tmp/validate-cookies.js << 'VALIDATE_EOF'
${validateScript}
VALIDATE_EOF
node /tmp/validate-cookies.js && rm -f /tmp/validate-cookies.js`;
  
  const result = await executeCommand(publicIp, validateCommand, keyFile, 30000);
  
  if (!result.success) {
    return { success: false, valid: false, error: 'Validation command failed' };
  }
  
  const output = result.stdout || '';
  const isValid = output.includes('VALID:');
  
  return {
    success: true,
    valid: isValid,
    error: isValid ? null : (output.includes('INVALID:') ? output.split('INVALID:')[1].trim() : 'Unknown validation error')
  };
}

/**
 * Run update checker on AWS instance
 */
async function runUpdateOnAWS(publicIp, keyFile) {
  console.log('\n🔍 Running update checker on AWS instance...');
  console.log('   This will check for updates in all courses');
  console.log('   Timeout: 10 minutes\n');
  
  const updateCommand = [
    'cd ~/Canvas-Wrapper &&',
    'export AWS_INSTANCE_ID=${AWS_INSTANCE_ID} &&',
    'export HEADLESS=true &&',
    'export UPDATE_DRY_RUN=true &&',
    'npm run update 2>&1'
  ].join(' ');
  
  // Use 10 minute timeout for update check
  const result = await executeCommand(publicIp, updateCommand, keyFile, 600000);
  
  // Parse output for any errors
  if (result.stdout) {
    console.log(result.stdout);
  }
  if (result.stderr) {
    console.error(result.stderr);
  }
  
  return {
    success: result.success,
    exitCode: result.exitCode,
    error: result.success ? null : (result.stderr || 'Unknown error')
  };
}

/**
 * Main execution
 */
async function main() {
  const overallStart = Date.now();
  
  try {
    console.log('🚀 AWS Update Checker Runner');
    console.log('='.repeat(60));
    console.log(`   Instance ID: ${AWS_INSTANCE_ID}`);
    console.log(`   Region: ${AWS_REGION}`);
    console.log('='.repeat(60));
    
    if (!AWS_INSTANCE_ID) {
      console.error('❌ Error: AWS_INSTANCE_ID environment variable is required');
      process.exit(1);
    }
    
    if (!fs.existsSync(AWS_KEY_FILE)) {
      console.error(`❌ Error: AWS key file not found: ${AWS_KEY_FILE}`);
      console.error('   Please set AWS_KEY_FILE environment variable');
      process.exit(1);
    }
    
    // Step 1: Start instance and confirm it's running
    console.log('\n📋 Step 1: Starting AWS instance...');
    const instanceStartTime = Date.now();
    
    const instanceResult = await ensureInstanceReady(AWS_INSTANCE_ID, null, AWS_KEY_FILE);
    
    if (!instanceResult.success) {
      console.error(`❌ Failed to start instance: ${instanceResult.error}`);
      
      // Provide context-specific error messages
      const errorMsg = instanceResult.error || '';
      if (errorMsg.includes('state') || errorMsg.includes('stopping') || errorMsg.includes('starting')) {
        console.error('   This is likely due to:');
        console.error('   - Instance is in a transitional state (stopping/starting)');
        console.error('   - Wait a few minutes and try again');
        console.error('   - Check the instance state in AWS Console');
      } else if (errorMsg.includes('SSH') || errorMsg.includes('not ready')) {
        console.error('   This could be due to:');
        console.error('   - Security group not allowing SSH from your IP');
        console.error('   - Instance still initializing');
        console.error('   - Network connectivity issues');
        console.error('   - SSH key file permissions or path issues');
      } else {
        console.error('   Please check:');
        console.error('   - Instance state in AWS Console');
        console.error('   - AWS credentials and permissions');
        console.error('   - Network connectivity');
      }
      process.exit(1);
    }
    
    const { publicIp, wasAlreadyRunning } = instanceResult;
    
    console.log('✅ Instance is running and SSH is ready');
    
    // Step 2: Sync code and cookies to instance
    console.log('\n📋 Step 2: Syncing code and cookies to AWS instance...');
    await syncCodeToInstance(publicIp, AWS_KEY_FILE);
    
    // Check if local cookie file exists before syncing
    const localCookiePath = path.join(__dirname, '..', 'data', 'auth', 'canvas-cookies.json');
    if (!fs.existsSync(localCookiePath)) {
      console.error('❌ Local cookie file not found:', localCookiePath);
      console.error('   Please extract cookies first: npm run auth:extract-cookies');
      process.exit(1);
    }
    
    const cookieSyncResult = await syncCookiesToInstance(publicIp, AWS_KEY_FILE);
    if (!cookieSyncResult.success) {
      console.error('❌ Failed to sync cookies to AWS instance');
      console.error('   Error:', cookieSyncResult.error || 'Unknown error');
      process.exit(1);
    }
    
    // Verify cookie file exists on remote instance
    console.log('🔍 Verifying cookie file exists on remote instance...');
    const verifyCommand = `test -f ~/Canvas-Wrapper/data/auth/canvas-cookies.json && echo "EXISTS" || echo "NOT_FOUND"`;
    const verifyResult = await executeCommand(publicIp, verifyCommand, AWS_KEY_FILE, 10000);
    if (verifyResult.stdout && verifyResult.stdout.includes('EXISTS')) {
      console.log('✅ Cookie file verified on remote instance');
    } else {
      console.error('❌ Cookie file not found on remote instance after sync');
      console.error('   This may indicate a sync issue. Please check:');
      console.error('   - File permissions on remote instance');
      console.error('   - Remote directory structure');
      process.exit(1);
    }
    
    // Step 3: Validate cookies
    console.log('\n📋 Step 3: Validating cookies...');
    const cookieValidation = await validateCookies(publicIp, AWS_KEY_FILE);
    
    if (!cookieValidation.success) {
      console.error('❌ Cookie validation failed');
      console.error('   Error:', cookieValidation.error || 'Unknown error');
      process.exit(1);
    }
    
    if (!cookieValidation.valid) {
      console.error('❌ Cookies are invalid. Please extract new cookies.');
      console.error('   Run locally: npm run auth:extract-cookies');
      console.error('   Then re-run this update to sync the new cookies.');
      process.exit(1);
    }
    
    console.log('✅ Cookies are valid');
    
    // Step 4: Run update checker on AWS
    console.log('\n📋 Step 4: Running update checker on AWS...');
    const updateResult = await runUpdateOnAWS(publicIp, AWS_KEY_FILE);
    
    if (!updateResult.success) {
      console.error(`❌ Update check failed: ${updateResult.error || 'Unknown error'}`);
      console.error(`   Exit code: ${updateResult.exitCode}`);
    } else {
      console.log('✅ Update check completed');
    }
    
    // Step 5: Hibernate instance
    console.log('\n📋 Step 5: Hibernating AWS instance...');
    
    // Add timeout for instance hibernation (5 minutes max)
    let cleanupResult;
    try {
      cleanupResult = await Promise.race([
        cleanup(AWS_INSTANCE_ID, wasAlreadyRunning, true),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Instance hibernation timeout after 5 minutes')), 300000)
        )
      ]);
    } catch (cleanupError) {
      console.error(`⚠️  Instance hibernation failed or timed out: ${cleanupError.message}`);
      cleanupResult = { success: false, error: cleanupError.message };
    }
    
    if (!cleanupResult.success) {
      console.error(`⚠️  Failed to hibernate instance: ${cleanupResult.error}`);
      console.error('   Please hibernate the instance manually to avoid charges!');
    } else {
      console.log('✅ Instance hibernated successfully');
    }
    
    const overallDuration = Date.now() - overallStart;
    const minutes = Math.floor(overallDuration / 60000);
    const seconds = Math.floor((overallDuration % 60000) / 1000);
    console.log(`\n✅ Update check completed in ${minutes}m ${seconds}s`);
    
    process.exit(updateResult.success ? 0 : 1);
  } catch (error) {
    console.error(`\n❌ Fatal error: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    
    // Try to hibernate instance on error
    try {
      console.log('\n🛑 Attempting to hibernate instance due to error...');
      await cleanup(AWS_INSTANCE_ID, false, true);
    } catch (cleanupError) {
      console.error(`⚠️  Failed to hibernate instance: ${cleanupError.message}`);
      console.error('   Please hibernate the instance manually!');
    }
    
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { main };

