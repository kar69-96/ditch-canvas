#!/usr/bin/env node
/**
 * AWS Update Checker Runner
 * Runs the Canvas update checker on AWS EC2 instance
 */

// Load .env file if it exists (check both root and backend directories)
const path = require('path');
const fs = require('fs');

// Try root .env first, then backend .env
const rootEnvPath = path.join(__dirname, '..', '..', '.env');
const backendEnvPath = path.join(__dirname, '..', '.env');

const envPaths = [rootEnvPath, backendEnvPath];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    console.log(`📝 Loading .env from: ${envPath}`);
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=').replace(/^["']|["']$/g, '');
        if (key && value) {
          // Don't override if already set (root .env takes priority)
          if (!process.env[key.trim()]) {
            process.env[key.trim()] = value.trim();
          }
        }
      }
    });
    break; // Use first found .env file
  }
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
 * Sync frontend directory to AWS instance (needed for upload script)
 */
async function syncFrontendSupabaseToInstance(publicIp, keyFile) {
  const rootDir = path.join(__dirname, '..', '..');
  const localFrontendPath = path.join(rootDir, 'frontend');
  const remoteFrontendPath = '~/frontend';
  
  if (!fs.existsSync(localFrontendPath)) {
    console.warn('⚠️  Frontend directory not found locally, skipping sync');
    return { success: false, error: 'Frontend directory not found' };
  }
  
  console.log(`\n📤 Syncing frontend directory to AWS instance...`);
  console.log(`   Local: ${localFrontendPath}`);
  console.log(`   Remote: ${remoteFrontendPath}`);
  
  const sshUser = process.env.AWS_SSH_USER || 'ec2-user';
  const { spawn } = require('child_process');
  
  return new Promise((resolve, reject) => {
    // Sync frontend directory but exclude large directories
    const rsyncCommand = [
      '-avz',
      '--exclude', 'node_modules',
      '--exclude', '.git',
      '--exclude', 'dist',
      '--exclude', 'build',
      '--exclude', '.next',
      '--exclude', '*.log',
      '--exclude', '.DS_Store',
      '-e', `ssh -i "${keyFile}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`,
      `${localFrontendPath}/`,
      `${sshUser}@${publicIp}:${remoteFrontendPath}/`
    ];
    
    const rsync = spawn('rsync', rsyncCommand, {
      stdio: 'inherit'
    });
    
    rsync.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Frontend directory synced successfully');
        // Install frontend dependencies on AWS if package.json exists
        console.log('📦 Installing frontend dependencies on AWS...');
        const installCommand = `cd ~/frontend && npm install --production 2>&1`;
        executeCommand(publicIp, installCommand, keyFile, 300000)
          .then((installResult) => {
            if (installResult.success) {
              console.log('✅ Frontend dependencies installed');
            } else {
              console.warn('⚠️  Frontend dependency installation had issues, but continuing...');
            }
            resolve({ success: true });
          })
          .catch((err) => {
            console.warn('⚠️  Failed to install frontend dependencies:', err.message);
            console.warn('   Upload script may still work if dependencies are already installed');
            resolve({ success: true }); // Don't fail the whole process
          });
      } else {
        console.error(`❌ Frontend sync failed with exit code ${code}`);
        reject({ success: false, exitCode: code });
      }
    });
    
    rsync.on('error', (error) => {
      console.error(`❌ Frontend sync error: ${error.message}`);
      reject({ success: false, error: error.message });
    });
  });
}

/**
 * Sync .env file to AWS instance (for Supabase credentials)
 */
async function syncEnvToInstance(publicIp, keyFile) {
  const localEnvPath = path.join(__dirname, '..', '.env');
  const rootEnvPath = path.join(__dirname, '..', '..', '.env');
  
  // Try root .env first, then backend .env
  let envPath = rootEnvPath;
  if (!fs.existsSync(envPath)) {
    envPath = localEnvPath;
  }
  
  if (!fs.existsSync(envPath)) {
    console.warn('⚠️  .env file not found, Supabase upload may fail');
    console.warn('   Make sure Supabase credentials are set on AWS instance');
    return { success: false, error: '.env file not found', skipped: true };
  }
  
  console.log(`\n📤 Syncing .env file to AWS instance...`);
  console.log(`   Local: ${envPath}`);
  
  const sshUser = process.env.AWS_SSH_USER || 'ec2-user';
  const remoteEnvPath = '~/Canvas-Wrapper/.env';
  const { spawn } = require('child_process');
  
  return new Promise((resolve) => {
    const rsyncCommand = [
      '-avz',
      '-e', `ssh -i "${keyFile}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`,
      envPath,
      `${sshUser}@${publicIp}:${remoteEnvPath}`
    ];
    
    const rsync = spawn('rsync', rsyncCommand, {
      stdio: 'inherit'
    });
    
    rsync.on('close', (code) => {
      if (code === 0) {
        console.log('✅ .env file synced successfully');
        resolve({ success: true });
      } else {
        console.warn(`⚠️  .env sync failed with exit code ${code}`);
        console.warn('   Supabase upload may fail if credentials are not available');
        resolve({ success: false, exitCode: code, skipped: true });
      }
    });
    
    rsync.on('error', (error) => {
      console.warn(`⚠️  .env sync error: ${error.message}`);
      console.warn('   Supabase upload may fail if credentials are not available');
      resolve({ success: false, error: error.message, skipped: true });
    });
  });
}

/**
 * Run update checker on AWS instance with retry logic
 * Retries until the script runs successfully (no module errors, etc.)
 */
async function runUpdateOnAWS(publicIp, keyFile) {
  const MAX_RETRIES = 10;
  const RETRY_DELAY_MS = 30000; // 30 seconds between retries
  const UPDATE_TIMEOUT_MS = 600000; // 10 minutes per attempt
  
  // Allow UPDATE_DRY_RUN to be overridden via environment variable
  // Default to false (apply changes) unless explicitly set to true
  const dryRun = process.env.UPDATE_DRY_RUN === 'true' ? 'true' : 'false';
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`\n🔍 Running update checker on AWS instance (Attempt ${attempt}/${MAX_RETRIES})...`);
    console.log('   This will check for updates and apply changes');
    console.log('   Timeout: 10 minutes per attempt\n');
    
    const updateCommand = [
      'cd ~/Canvas-Wrapper &&',
      'export AWS_INSTANCE_ID=${AWS_INSTANCE_ID} &&',
      'export HEADLESS=true &&',
      `export UPDATE_DRY_RUN=${dryRun} &&`,
      'npm run update 2>&1'
    ].join(' ');
    
    // Use 10 minute timeout for update check
    const result = await executeCommand(publicIp, updateCommand, keyFile, UPDATE_TIMEOUT_MS);
    
    // Parse output for any errors
    const output = (result.stdout || '') + (result.stderr || '');
    
    if (result.stdout) {
      console.log('--- Update Script Output ---');
      console.log(result.stdout);
      console.log('--- End Output ---');
    }
    if (result.stderr) {
      console.error('--- Update Script Errors ---');
      console.error(result.stderr);
      console.error('--- End Errors ---');
    }
    
    // Check for module errors (like cheerio)
    const hasModuleError = output.includes('Cannot find module') || 
                          output.includes('MODULE_NOT_FOUND') ||
                          output.includes('Error: Cannot find module');
    
    // Check if update script completed successfully (ran without errors)
    const hasCompletedIndicator = output.includes('Update Summary') ||
                                  output.includes('Completed in') ||
                                  output.includes('✅ No updates found') ||
                                  output.includes('✅ Update check completed');
    
    // Check if changes were actually found
    const hasChangesFound = output.includes('Found updates in') ||
                           output.includes('coursesWithUpdates') ||
                           output.includes('⚠️  Found updates') ||
                           output.includes('Successfully applied') ||
                           output.includes('changesApplied');
    
    // Check if no changes were found (still a success, but we might want to retry)
    const hasNoChanges = output.includes('✅ No updates found') ||
                        output.includes('All courses are up to date');
    
    // IMPORTANT: Check for successful completion FIRST before checking for fatal errors
    // This prevents false positives where helpful messages are flagged as fatal errors
    // Only check for fatal errors if the script actually failed (not successful completion)
    const isScriptSuccessful = result.success && hasCompletedIndicator;
    
    // Check for fatal errors that shouldn't be retried
    // Only treat as fatal if:
    // 1. Script failed (not successful), AND
    // 2. Contains actual fatal error messages (not helpful hints in successful runs)
    const hasFatalError = !isScriptSuccessful && (
      (output.includes('❌ Extraction summary not found') && !output.includes('Update Summary')) ||
      (output.includes('❌ No user email found') && !output.includes('Update Summary')) ||
      (output.includes('❌ Cookie file not found') && !output.includes('Update Summary')) ||
      // Only treat as fatal if it's an actual error message, not a helpful hint
      (output.includes('Extraction summary not found. Please run:') && 
       !output.includes('Update Summary') && 
       !output.includes('Completed in'))
    );
    
    if (hasFatalError) {
      console.error('\n❌ Fatal error detected - cannot retry:');
      if (output.includes('Extraction summary not found')) {
        console.error('   Extraction summary not found. Please run a full extraction first.');
      } else if (output.includes('No user email found')) {
        console.error('   No user email found in extraction summary.');
      } else if (output.includes('Cookie file not found')) {
        console.error('   Cookie file not found.');
      }
      return {
        success: false,
        exitCode: result.exitCode,
        error: 'Fatal error - cannot retry',
        fatal: true
      };
    }
    
    // If we have a module error, try reinstalling dependencies and retry
    if (hasModuleError) {
      console.error(`\n❌ Module error detected on attempt ${attempt}`);
      console.log('📦 Reinstalling dependencies and retrying...');
      
      // Reinstall dependencies
      const reinstallResult = await executeCommand(
        publicIp,
        'cd ~/Canvas-Wrapper && rm -rf node_modules package-lock.json && npm install 2>&1',
        keyFile,
        600000 // 10 minute timeout
      );
      
      if (reinstallResult.success) {
        console.log('✅ Dependencies reinstalled successfully');
      } else {
        console.warn('⚠️  Dependency reinstall had issues, but continuing...');
        if (reinstallResult.stdout) console.log(reinstallResult.stdout);
        if (reinstallResult.stderr) console.error(reinstallResult.stderr);
      }
      
      // Wait before retrying
      if (attempt < MAX_RETRIES) {
        console.log(`⏳ Waiting ${RETRY_DELAY_MS / 1000} seconds before retry...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        continue; // Retry
      }
    }
    
    // If script ran successfully (exit code 0) and completed
    if (result.success && hasCompletedIndicator) {
      // Check if changes were found
      if (hasChangesFound) {
        console.log(`\n✅ Update script completed successfully and found changes on attempt ${attempt}`);
        return {
          success: true,
          exitCode: 0,
          error: null,
          attempt: attempt,
          changesFound: true
        };
      } else if (hasNoChanges) {
        console.log(`\n✅ Update script completed but no changes found on attempt ${attempt}`);
        // If user wants to keep retrying until changes are found, retry
        if (attempt < MAX_RETRIES) {
          console.log('   Retrying to check for new changes...');
          console.log(`⏳ Waiting ${RETRY_DELAY_MS / 1000} seconds before retry...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          continue; // Retry to find changes
        } else {
          // Max retries reached, no changes found
          console.log(`\n⚠️  No changes found after ${MAX_RETRIES} attempts`);
          return {
            success: true, // Script ran successfully, just no changes
            exitCode: 0,
            error: null,
            attempt: attempt,
            changesFound: false
          };
        }
      } else {
        // Script completed but we can't determine if changes were found
        console.log(`\n✅ Update script completed on attempt ${attempt}`);
        return {
          success: true,
          exitCode: 0,
          error: null,
          attempt: attempt,
          changesFound: null // Unknown
        };
      }
    }
    
    // If script failed but we don't have module errors, check if it's a real failure
    if (!result.success && !hasModuleError) {
      // Script failed for other reasons - might be transient
      if (attempt < MAX_RETRIES) {
        console.warn(`⚠️  Update script failed on attempt ${attempt}, retrying...`);
        console.log(`⏳ Waiting ${RETRY_DELAY_MS / 1000} seconds before retry...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      } else {
        console.error(`\n❌ Update script failed after ${MAX_RETRIES} attempts`);
        return {
          success: false,
          exitCode: result.exitCode,
          error: result.stderr || 'Unknown error after max retries',
          attempt: attempt
        };
      }
    }
    
    // If we get here and still have module errors after max retries
    if (hasModuleError && attempt >= MAX_RETRIES) {
      console.error(`\n❌ Module errors persist after ${MAX_RETRIES} attempts`);
      console.error('   Please check dependencies manually on AWS instance');
      return {
        success: false,
        exitCode: result.exitCode,
        error: 'Module errors persist after max retries',
        attempt: attempt
      };
    }
  }
  
  // Should never reach here, but just in case
  return {
    success: false,
    exitCode: 1,
    error: 'Unexpected end of retry loop',
    attempt: MAX_RETRIES
  };
}

/**
 * Main execution
 */
async function main() {
  const overallStart = Date.now();
  let instanceStarted = false;
  let wasAlreadyRunning = false;
  let publicIp = null;
  let exitCode = 0;
  
  try {
    console.log('🚀 AWS Update Checker Runner');
    console.log('='.repeat(60));
    console.log(`   Instance ID: ${AWS_INSTANCE_ID}`);
    console.log(`   Region: ${AWS_REGION}`);
    console.log('='.repeat(60));
    
    if (!AWS_INSTANCE_ID) {
      console.error('❌ Error: AWS_INSTANCE_ID environment variable is required');
      exitCode = 1;
      return;
    }
    
    if (!fs.existsSync(AWS_KEY_FILE)) {
      console.error(`❌ Error: AWS key file not found: ${AWS_KEY_FILE}`);
      console.error('   Please set AWS_KEY_FILE environment variable');
      exitCode = 1;
      return;
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
      exitCode = 1;
      return;
    }
    
    // Mark instance as started - we need to hibernate it
    instanceStarted = true;
    publicIp = instanceResult.publicIp;
    wasAlreadyRunning = instanceResult.wasAlreadyRunning;
    
    console.log('✅ Instance is running and SSH is ready');
    
    // Step 2: Sync code, frontend/supabase, .env, and cookies to instance
    console.log('\n📋 Step 2: Syncing code and dependencies to AWS instance...');
    await syncCodeToInstance(publicIp, AWS_KEY_FILE);
    
    // Install backend dependencies on AWS (required for update script)
    console.log('📦 Installing backend dependencies on AWS...');
    console.log('   This may take a few minutes...');
    const installBackendResult = await executeCommand(
      publicIp,
      'cd ~/Canvas-Wrapper && npm install --production=false 2>&1',
      AWS_KEY_FILE,
      600000 // 10 minute timeout (npm install can take time)
    );
    
    if (installBackendResult.stdout) {
      // Show last few lines of npm install output
      const outputLines = installBackendResult.stdout.split('\n');
      const lastLines = outputLines.slice(-20).join('\n');
      console.log('   npm install output (last 20 lines):');
      console.log(lastLines);
    }
    
    if (installBackendResult.success) {
      console.log('✅ Backend dependencies installed successfully');
    } else {
      console.error('❌ Backend dependency installation failed:');
      if (installBackendResult.stdout) {
        const outputLines = installBackendResult.stdout.split('\n');
        const errorLines = outputLines.filter(line => 
          line.toLowerCase().includes('error') || 
          line.toLowerCase().includes('failed') ||
          line.toLowerCase().includes('warn')
        );
        if (errorLines.length > 0) {
          console.error('   Errors:');
          errorLines.slice(-10).forEach(line => console.error(`   ${line}`));
        }
      }
      if (installBackendResult.stderr) {
        console.error('   stderr:', installBackendResult.stderr);
      }
      console.error('   The update script may fail without proper dependencies.');
      console.error('   Continuing anyway - you may need to install dependencies manually on AWS');
    }
    
    // Sync frontend/supabase directory for upload script
    try {
      await syncFrontendSupabaseToInstance(publicIp, AWS_KEY_FILE);
    } catch (error) {
      console.warn('⚠️  Failed to sync frontend/supabase, upload may not work:', error.message);
    }
    
    // Sync .env file for Supabase credentials
    try {
      await syncEnvToInstance(publicIp, AWS_KEY_FILE);
    } catch (error) {
      console.warn('⚠️  Failed to sync .env, Supabase upload may fail:', error.message);
    }
    
    // Check if local cookie file exists before syncing
    const localCookiePath = path.join(__dirname, '..', 'data', 'auth', 'canvas-cookies.json');
    if (!fs.existsSync(localCookiePath)) {
      console.error('❌ Local cookie file not found:', localCookiePath);
      console.error('   Please extract cookies first: npm run auth:extract-cookies');
      exitCode = 1;
      return;
    }
    
    const cookieSyncResult = await syncCookiesToInstance(publicIp, AWS_KEY_FILE);
    if (!cookieSyncResult.success) {
      console.error('❌ Failed to sync cookies to AWS instance');
      console.error('   Error:', cookieSyncResult.error || 'Unknown error');
      exitCode = 1;
      return;
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
      exitCode = 1;
      return;
    }
    
    // Step 3: Validate cookies
    console.log('\n📋 Step 3: Validating cookies...');
    const cookieValidation = await validateCookies(publicIp, AWS_KEY_FILE);
    
    if (!cookieValidation.success) {
      console.error('❌ Cookie validation failed');
      console.error('   Error:', cookieValidation.error || 'Unknown error');
      exitCode = 1;
      return;
    }
    
    if (!cookieValidation.valid) {
      console.error('❌ Cookies are invalid. Please extract new cookies.');
      console.error('   Run locally: npm run auth:extract-cookies');
      console.error('   Then re-run this update to sync the new cookies.');
      exitCode = 1;
      return;
    }
    
    console.log('✅ Cookies are valid');
    
    // Step 4: Run update checker on AWS (with retry logic)
    console.log('\n📋 Step 4: Running update checker on AWS...');
    const updateResult = await runUpdateOnAWS(publicIp, AWS_KEY_FILE);
    
    if (!updateResult.success) {
      if (updateResult.fatal) {
        console.error(`❌ Update check failed with fatal error: ${updateResult.error || 'Unknown error'}`);
        console.error(`   Cannot retry - please fix the issue and try again`);
        exitCode = 1;
      } else {
        console.error(`❌ Update check failed after ${updateResult.attempt || 'multiple'} attempts: ${updateResult.error || 'Unknown error'}`);
        console.error(`   Exit code: ${updateResult.exitCode}`);
        exitCode = 1;
      }
    } else {
      if (updateResult.changesFound === true) {
        console.log(`✅ Update check completed successfully and found changes (attempt ${updateResult.attempt || 1})`);
      } else if (updateResult.changesFound === false) {
        console.log(`✅ Update check completed but no changes found after ${updateResult.attempt || 1} attempts`);
        console.log('   All courses are up to date');
        exitCode = 0; // No changes is still a success
      } else {
        console.log(`✅ Update check completed (attempt ${updateResult.attempt || 1})`);
        exitCode = 0; // Script ran successfully
      }
    }
    
  } catch (error) {
    console.error(`\n❌ Fatal error: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    exitCode = 1;
  } finally {
    // Step 5: ALWAYS hibernate instance (even on errors)
    if (instanceStarted) {
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
        console.error('   ⚠️  IMPORTANT: Please hibernate the instance manually to avoid charges!');
        console.error(`   Instance ID: ${AWS_INSTANCE_ID}`);
        console.error('   Go to AWS Console → EC2 → Instances → Select instance → Instance State → Stop/Hibernate');
      } else {
        console.log('✅ Instance hibernated successfully');
      }
    } else {
      console.log('\n💤 Skipping hibernation - instance was not started');
    }
    
    const overallDuration = Date.now() - overallStart;
    const minutes = Math.floor(overallDuration / 60000);
    const seconds = Math.floor((overallDuration % 60000) / 1000);
    console.log(`\n✅ Process completed in ${minutes}m ${seconds}s`);
    
    process.exit(exitCode);
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

