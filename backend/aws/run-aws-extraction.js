#!/usr/bin/env node
/**
 * AWS Extraction Runner with Optimized Processing
 * Automates full extraction workflow: instance management, cookie validation, mapping, extraction, and hibernation
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

const { ensureInstanceReady, executeCommand, cleanup, getInstanceDetails, waitForSSH } = require('./utils/aws-ec2-manager.js');
const { collectMetrics } = require('./utils/cloudwatch-metrics.js');
const { spawn } = require('child_process');

// Configuration
const AWS_INSTANCE_ID = process.env.AWS_INSTANCE_ID;
const AWS_KEY_FILE = process.env.AWS_KEY_FILE || path.join(__dirname, '..', 'Canvas-Wrapper.pem');
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// Storage structure: storage/datasets/extraction-{timestamp}/
// The extraction folder is created by the crawler and contains mapping/ and courses/ subdirectories
const OUTPUT_BASE_DIR = `storage/datasets`;
const OUTPUT_DIR = OUTPUT_BASE_DIR;

// Metrics tracking
const metrics = {
  timings: {
    instanceStart: null,
    instanceStartDuration: 0,
    sshReady: null,
    sshReadyDuration: 0,
    cookieValidation: null,
    cookieValidationDuration: 0,
    mappingStart: null,
    mappingEnd: null,
    mappingDuration: 0,
    extractionStart: null,
    extractionEnd: null,
    extractionDuration: 0,
    downloadStart: null,
    downloadEnd: null,
    downloadDuration: 0,
    instanceStop: null,
    instanceStopDuration: 0,
    totalDuration: 0
  },
  concurrency: {
    maxConcurrent: 0,
    averageConcurrent: 0,
    currentConcurrent: 0,
    samples: []
  },
  errors: {
    authentication: 0,
    network: 0,
    timeout: 0,
    other: 0,
    total: 0
  },
  rateLimiting: {
    rateLimitHits: 0,
    retries: 0,
    backoffEvents: 0
  },
  requests: {
    total: 0,
    successful: 0,
    failed: 0,
    retried: 0
  },
  instanceType: null,
  optimizedSettings: {},
  cloudWatch: {
    cpu: null,
    memory: null,
    network: null,
    collectionTime: null
  }
};

/**
 * Optimize concurrency and parallelism settings based on instance type
 */
function optimizeSettings(instanceType) {
  metrics.instanceType = instanceType;
  
  // Default settings (optimized for maximum performance)
  let maxConcurrency = 80;
  let parallelLimit = 20; // Max 20 courses in parallel
  let maxRequestsPerCrawl = 2000;
  
  // Optimize based on instance type
  if (instanceType) {
    const instanceTypeLower = instanceType.toLowerCase();
    
    // r7i.2xlarge: 8 vCPUs, 64 GiB RAM
    // Maximum concurrency for speed - optimized for AWS constraints
    if (instanceTypeLower.includes('r7i.2xlarge')) {
      maxConcurrency = 100; // Optimized for database and memory constraints
      parallelLimit = 20; // Max 20 courses in parallel
      maxRequestsPerCrawl = 2000;
    }
    // r7i.xlarge: 4 vCPUs, 32 GiB RAM
    else if (instanceTypeLower.includes('r7i.xlarge')) {
      maxConcurrency = 50;
      parallelLimit = 20; // Max 20 courses
      maxRequestsPerCrawl = 1500;
    }
    // r7i.4xlarge: 16 vCPUs, 128 GiB RAM
    else if (instanceTypeLower.includes('r7i.4xlarge')) {
      maxConcurrency = 150;
      parallelLimit = 20; // Max 20 courses
      maxRequestsPerCrawl = 3000;
    }
    // r7i.8xlarge: 32 vCPUs, 256 GiB RAM
    else if (instanceTypeLower.includes('r7i.8xlarge')) {
      maxConcurrency = 200;
      parallelLimit = 20; // Max 20 courses
      maxRequestsPerCrawl = 4000;
    }
    // m7i instances (general purpose)
    else if (instanceTypeLower.includes('m7i.2xlarge')) {
      maxConcurrency = 80;
      parallelLimit = 20; // Max 20 courses
      maxRequestsPerCrawl = 2000;
    }
    else if (instanceTypeLower.includes('m7i.xlarge')) {
      maxConcurrency = 50;
      parallelLimit = 20; // Max 20 courses
      maxRequestsPerCrawl = 1500;
    }
    else if (instanceTypeLower.includes('m7i.4xlarge')) {
      maxConcurrency = 120;
      parallelLimit = 20; // Max 20 courses
      maxRequestsPerCrawl = 2500;
    }
  }
  
  metrics.optimizedSettings = {
    maxConcurrency,
    parallelLimit,
    maxRequestsPerCrawl,
    maxDepth: 3
  };
  
  return metrics.optimizedSettings;
}

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}

/**
 * Track timing for a specific event
 */
function trackTiming(event, startTime = null) {
  const now = Date.now();
  if (startTime) {
    const duration = now - startTime;
    metrics.timings[`${event}Duration`] = duration;
    console.log(`\n⏱️  ${event}: ${formatDuration(duration)}`);
  } else {
    metrics.timings[event] = now;
    console.log(`\n📅 ${event}: ${new Date(now).toISOString()}`);
  }
}

/**
 * Parse crawler output for metrics
 */
function parseCrawlerOutput(output) {
  const lines = output.split('\n');
  
  lines.forEach(line => {
    // Track authentication errors - only count actual HTTP 401/403 errors, not log messages
    // Pattern: "HTTP 401" or "HTTP 403" or "401 Unauthorized" or "403 Forbidden"
    if ((line.match(/HTTP\s+(401|403)/) || line.match(/(401|403)\s+(Unauthorized|Forbidden)/)) && 
        !line.includes('⚠️') && !line.includes('WARNING') && !line.includes('Possible')) {
      metrics.errors.authentication++;
      metrics.errors.total++;
    }
    
    // Track network errors - only actual errors, not log messages
    if ((line.includes('ETIMEDOUT') || line.includes('ECONNRESET')) && 
        (line.includes('Error') || line.includes('Failed') || line.includes('❌'))) {
      metrics.errors.network++;
      metrics.errors.total++;
    }
    
    // Track timeouts - only actual timeout errors, not log messages about timeouts
    if ((line.includes('timeout') || line.includes('Timeout')) && 
        (line.includes('Error') || line.includes('Failed') || line.includes('❌') || line.includes('timed out'))) {
      metrics.errors.timeout++;
      metrics.errors.total++;
    }
    
    // Track rate limiting - only actual 429 errors
    if (line.match(/HTTP\s+429/) || (line.includes('429') && line.includes('Too Many Requests'))) {
      metrics.rateLimiting.rateLimitHits++;
    }
    
    // Track retries - only actual retry events, not log messages
    if ((line.includes('retry') || line.includes('Retry')) && 
        (line.includes('Retrying') || line.includes('retrying') || line.match(/retry\s+\d+/i))) {
      metrics.rateLimiting.retries++;
      metrics.requests.retried++;
    }
    
    // Track concurrency
    const concurrencyMatch = line.match(/concurrent[:\s]+(\d+)/i);
    if (concurrencyMatch) {
      const concurrent = parseInt(concurrencyMatch[1]);
      metrics.concurrency.samples.push(concurrent);
      metrics.concurrency.maxConcurrent = Math.max(metrics.concurrency.maxConcurrent, concurrent);
      metrics.concurrency.currentConcurrent = concurrent;
    }
    
    // Track request counts
    const requestMatch = line.match(/(\d+)\s+requests?/i);
    if (requestMatch) {
      metrics.requests.total = Math.max(metrics.requests.total, parseInt(requestMatch[1]));
    }
  });
}

/**
 * Validate cookies on AWS instance
 */
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

async function validateCookies(publicIp, keyFile) {
  trackTiming('cookieValidation');
  const validationStart = Date.now();
  
  console.log('\n🔍 Validating cookies on AWS instance...');
  
  const validationCommand = 'cd ~/Canvas-Wrapper && npm run auth:validate-cookies 2>&1';
  
  const result = await executeCommand(publicIp, validationCommand, keyFile);
  
  trackTiming('cookieValidation', validationStart);
  
  // Check for explicit validation success
  const fullOutput = (result.stdout || '') + (result.stderr || '');
  const outputLower = fullOutput.toLowerCase();
  
  // If we see "valid" without "invalid" in the same context, cookies are valid
  if (outputLower.includes('cookies are valid') || 
      (outputLower.includes('valid') && !outputLower.includes('invalid') && outputLower.includes('status: valid'))) {
    console.log('✅ Cookies are valid');
    return { success: true, valid: true };
  }
  
  // Check for navigation errors FIRST (before checking for "invalid")
  // These are usually false negatives when Canvas redirects during validation
  // Check both lowercase and original case to be sure
  if (outputLower.includes('execution context was destroyed') || 
      fullOutput.includes('Execution context was destroyed') ||
      fullOutput.includes('execution context was destroyed')) {
    // Check if we got a 200 response code (various formats)
    if (outputLower.includes('response code') && outputLower.includes('200') ||
        fullOutput.includes('Response Code: 200')) {
      console.log('⚠️  Validation had navigation error but got 200 response - assuming cookies are valid');
      return { success: true, valid: true };
    }
    // Even without explicit 200, if we see "execution context destroyed" it's usually a timing issue
    // and the page actually loaded (Canvas redirects cause this)
    console.log('⚠️  Validation had navigation timing error (likely false negative) - assuming cookies are valid');
    return { success: true, valid: true };
  }
  
  // If we see "invalid" explicitly (and it's not a navigation error), cookies are invalid
  if (outputLower.includes('cookies are invalid') || 
      (outputLower.includes('invalid') && outputLower.includes('status: invalid'))) {
    console.error('❌ Cookies are invalid');
    return { success: true, valid: false };
  }
  
  // If we can't determine, assume valid and continue (cookies might be on instance)
  // This is safer than blocking extraction - cookies will be tested during actual extraction
  console.log('⚠️  Could not determine cookie validity, proceeding with assumption that cookies are valid...');
  console.log('   (Cookies will be validated during actual extraction if they are truly invalid)');
  return { success: true, valid: true };
}

/**
 * Run mapping phase on AWS instance
 */
async function runMappingPhase(publicIp, keyFile, settings) {
  trackTiming('mappingStart');
  const mappingStart = Date.now();
  
  console.log('\n📋 Phase 1: Running Mapping Phase...');
  console.log(`   Max Depth: ${settings.maxDepth}`);
  console.log(`   Max Concurrency: ${settings.maxConcurrency}`);
  console.log(`   Max Requests: ${settings.maxRequestsPerCrawl}`);
  
  // Crawler uses timestamped extraction folders: storage/datasets/extraction-{timestamp}/
  // with mapping/ and courses/ subdirectories
  
  const mappingCommand = [
    'cd ~/Canvas-Wrapper &&',
    `export AWS_INSTANCE_TYPE=${metrics.instanceType} &&`,
    `export EXTRACT_COURSES=all &&`,
    `export MAX_CONCURRENCY=${settings.maxConcurrency} &&`,
    `export MAX_DEPTH=${settings.maxDepth} &&`,
    `export MAX_REQUESTS_PER_CRAWL=${settings.maxRequestsPerCrawl} &&`,
    `export SKIP_DOWNLOADS=true &&`,
    `export HEADLESS=true &&`,
    `export AWS_INSTANCE_ID=${AWS_INSTANCE_ID} &&`,
    'export MAP_ONLY=true &&',
    'npm run crawl:map 2>&1 | tee /tmp/mapping.log'
  ].join(' ');
  
  console.log(`\n📋 Running mapping command...`);
  console.log(`   ⏱️  Timeout: 1 hour (mapping should complete quickly)`);
  
  // Use 1 hour timeout for mapping (3600000ms)
  const result = await executeCommand(publicIp, mappingCommand, keyFile, 3600000);
  
  trackTiming('mappingEnd', mappingStart);
  
  // Parse output for metrics
  if (result.stdout) {
    parseCrawlerOutput(result.stdout);
  }
  if (result.stderr) {
    parseCrawlerOutput(result.stderr);
  }
  
  // Also try to get the log file
  try {
    const logResult = await executeCommand(publicIp, 'cat /tmp/mapping.log', keyFile);
    if (logResult.stdout) {
      parseCrawlerOutput(logResult.stdout);
    }
  } catch (e) {
    console.log('⚠️  Could not read mapping log file');
  }
  
  return result;
}

/**
 * Run complete extraction on AWS (mapping + extraction + downloads)
 * This consolidates all phases into a single command on AWS
 */
async function runFullExtractionOnAWS(publicIp, keyFile, settings) {
  trackTiming('extractionStart');
  const extractionStart = Date.now();
  
  console.log('\n📥 Running Complete Extraction on AWS...');
  console.log(`   Max Concurrency: ${settings.maxConcurrency}`);
  console.log(`   Parallel Courses: ${settings.parallelLimit}`);
  console.log(`   Phases: Mapping → Extraction → Downloads`);
  
  // Crawler uses timestamped extraction folders: storage/datasets/extraction-{timestamp}/
  // with mapping/ and courses/ subdirectories
  
  // Single command that runs: mapping → extraction → downloads
  // This runs all phases sequentially on AWS for all courses
  // Use crawl:canvas (not crawl:extract) to avoid hardcoded USE_URL_MAP=true
  const fullExtractionCommand = [
    'cd ~/Canvas-Wrapper &&',
    `export AWS_INSTANCE_TYPE=${metrics.instanceType} &&`,
    `export EXTRACT_COURSES=all &&`,
    `export MAX_CONCURRENCY=${settings.maxConcurrency} &&`,
    `export MAX_DEPTH=${settings.maxDepth} &&`,
    `export MAX_REQUESTS_PER_CRAWL=${settings.maxRequestsPerCrawl} &&`,
    `export SKIP_DOWNLOADS=false &&`, // Enable downloads on AWS
    `export HEADLESS=true &&`,
    `export AWS_INSTANCE_ID=${AWS_INSTANCE_ID} &&`,
    'npm run crawl:canvas 2>&1 | tee /tmp/full-extraction.log'
  ].join(' ');
  
  console.log(`\n📋 Running complete extraction command on AWS...`);
  console.log(`   ⏱️  Timeout: 3 hours (mapping + extraction + downloads for all courses)`);
  console.log(`   This will: 1) Map all courses, 2) Extract all content, 3) Download all files`);
  
  // Use 3 hour timeout for full extraction (10800000ms)
  console.log('⏳ Waiting for extraction to complete (this may take several minutes)...');
  const result = await executeCommand(publicIp, fullExtractionCommand, keyFile, 10800000);
  
  trackTiming('extractionEnd', extractionStart);
  
  console.log(`\n✅ Extraction command completed with exit code: ${result.exitCode || 'N/A'}`);
  
  // Parse output for metrics
  if (result.stdout) {
    parseCrawlerOutput(result.stdout);
  }
  if (result.stderr) {
    parseCrawlerOutput(result.stderr);
  }
  
  // Also try to get the log file
  try {
    console.log('📋 Reading extraction log file...');
    const logResult = await executeCommand(publicIp, 'cat /tmp/full-extraction.log 2>/dev/null || echo "Log file not found"', keyFile, 30000);
    if (logResult.stdout && !logResult.stdout.includes('Log file not found')) {
      parseCrawlerOutput(logResult.stdout);
    }
  } catch (e) {
    console.log('⚠️  Could not read full extraction log file');
  }
  
  // Verify extraction completed by checking for summary file
  try {
    console.log('🔍 Verifying extraction completion...');
    const verifyResult = await executeCommand(publicIp, 'test -f ~/Canvas-Wrapper/storage/multi-course-summary.json && echo "EXISTS" || echo "NOT_FOUND"', keyFile, 10000);
    if (verifyResult.stdout && verifyResult.stdout.includes('EXISTS')) {
      console.log('✅ Extraction summary file found - extraction completed successfully');
    } else {
      console.log('⚠️  Extraction summary file not found - extraction may not have completed');
    }
  } catch (e) {
    console.log('⚠️  Could not verify extraction completion');
  }
  
  return result;
}

/**
 * Monitor extraction progress
 */
function startMonitoring(publicIp, keyFile) {
  console.log('\n📊 Starting extraction monitoring...');
  console.log('   Monitoring will track:');
  console.log('   - Request counts');
  console.log('   - Concurrency levels');
  console.log('   - Error rates');
  console.log('   - Rate limiting events');
  console.log('\n   (Real-time output is streamed above)');
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
 * Try to read the latest extraction folder from the tracker file written by the crawler
 */
async function readTrackedExtractionFolder(publicIp, keyFile) {
  const trackerCommand = 'cat ~/Canvas-Wrapper/storage/latest-extraction-folder.json 2>/dev/null';
  const trackerResult = await executeCommand(publicIp, trackerCommand, keyFile, 10000);
  
  if (trackerResult.success && trackerResult.stdout && trackerResult.stdout.trim()) {
    try {
      const tracker = JSON.parse(trackerResult.stdout.trim());
      if (tracker.folder && tracker.folder.startsWith('extraction-')) {
        console.log(`   ✅ Tracker file indicates latest folder: ${tracker.folder}`);
        return tracker.folder;
      }
    } catch (error) {
      console.log('   ⚠️  Could not parse tracker file, falling back to directory scan');
    }
  }
  
  return null;
}

/**
 * Find the most recent extraction folder on the remote instance
 */
async function findLatestExtractionFolder(publicIp, keyFile) {
  console.log('\n🔍 Finding latest extraction folder on AWS instance...');
  
  const trackedFolder = await readTrackedExtractionFolder(publicIp, keyFile);
  if (trackedFolder) {
    return trackedFolder;
  }
  
  // List all extraction folders (extraction-*)
  const listCommand = 'ls -td ~/Canvas-Wrapper/storage/datasets/extraction-* 2>/dev/null | head -1';
  const result = await executeCommand(publicIp, listCommand, keyFile, 30000);
  
  if (result.success && result.stdout && result.stdout.trim()) {
    const remotePath = result.stdout.trim();
    const folderName = remotePath.split('/').pop();
    if (folderName && folderName.startsWith('extraction-')) {
      console.log(`   ✅ Found extraction folder: ${folderName}`);
      return folderName;
    }
  }
  
  console.error('   ❌ Could not find extraction folder on remote instance');
  console.error('      Please ensure an extraction has completed and the tracker file exists.');
  return null;
}

/**
 * Generate extraction summary on the remote instance
 */
async function generateExtractionSummaryOnAWS(publicIp, keyFile, extractionFolder) {
  if (!extractionFolder) {
    console.error('   ❌ Cannot generate extraction summary without a target folder');
    return { success: false, error: 'Missing extraction folder' };
  }

  console.log(`\n📝 Generating extraction summary for ${extractionFolder} on AWS instance...`);

  const summaryCommand = [
    'cd ~/Canvas-Wrapper &&',
    `EXTRACTION_FOLDER="${extractionFolder}" node scripts/generate-extraction-summary.js "${extractionFolder}" 2>&1`
  ].join(' ');

  const result = await executeCommand(publicIp, summaryCommand, keyFile, 600000);

  if (!result.success) {
    console.error('   ❌ Extraction summary generation failed');
    return { success: false, error: result.stderr || 'Unknown summary error' };
  }

  console.log('   ✅ Extraction summary generated successfully');
  return { success: true };
}

/**
 * Download results from AWS instance
 */
async function downloadResults(publicIp, keyFile, extractionFolderOverride = null) {
  trackTiming('downloadStart');
  
  // Find the latest extraction folder on the remote instance
  const extractionFolder = extractionFolderOverride || await findLatestExtractionFolder(publicIp, keyFile);
  
  if (!extractionFolder) {
    throw new Error('Could not find extraction folder on remote instance');
  }
  
  // Download from the timestamped extraction folder
  const remotePath = `~/Canvas-Wrapper/storage/datasets/${extractionFolder}`;
  const localPath = path.join(__dirname, '..', OUTPUT_BASE_DIR, extractionFolder);
  
  // Ensure local directory exists
  if (!fs.existsSync(localPath)) {
    fs.mkdirSync(localPath, { recursive: true });
  }
  
  console.log(`\n📥 Downloading results from AWS instance...`);
  console.log(`   Remote: ${remotePath}`);
  console.log(`   Local: ${localPath}`);
  
  const sshUser = process.env.AWS_SSH_USER || 'ec2-user';
  return new Promise((resolve, reject) => {
    let rsyncProcess = null;
    
    // Add timeout to prevent hanging (10 minutes max for download)
    const downloadTimeout = setTimeout(() => {
      if (rsyncProcess) {
        console.error('⏱️  Download taking longer than expected, terminating...');
        rsyncProcess.kill('SIGTERM');
        setTimeout(() => {
          if (rsyncProcess && !rsyncProcess.killed) {
            rsyncProcess.kill('SIGKILL');
          }
        }, 5000);
      }
      console.error('❌ Download timed out after 10 minutes');
      reject({ success: false, error: 'Download timeout' });
    }, 600000); // 10 minutes
    
    const rsyncCommand = [
      '-avz',
      '--progress',
      '--timeout=300', // 5 minute timeout for rsync
      '-e', `ssh -i "${keyFile}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=30 -o ServerAliveInterval=30 -o ServerAliveCountMax=3`,
      `${sshUser}@${publicIp}:${remotePath}/`,
      `${localPath}/`
    ];
    
    rsyncProcess = spawn('rsync', rsyncCommand, {
      stdio: 'inherit'
    });
    
    rsyncProcess.on('close', (code) => {
      clearTimeout(downloadTimeout);
      trackTiming('downloadEnd', metrics.timings.downloadStart);
      if (code === 0) {
        console.log('✅ Results downloaded successfully');
        resolve({ success: true });
      } else {
        console.error(`❌ Download failed with exit code ${code}`);
        reject({ success: false, exitCode: code });
      }
    });
    
    rsyncProcess.on('error', (error) => {
      clearTimeout(downloadTimeout);
      console.error(`❌ Download error: ${error.message}`);
      reject({ success: false, error: error.message });
    });
  });
}

/**
 * Generate and save metrics report
 */
function saveMetricsReport(extractionFolder = null) {
  // Calculate average concurrency
  if (metrics.concurrency.samples.length > 0) {
    metrics.concurrency.averageConcurrent = 
      metrics.concurrency.samples.reduce((a, b) => a + b, 0) / metrics.concurrency.samples.length;
  }
  
  // Calculate total duration
  if (metrics.timings.instanceStart && metrics.timings.instanceStop) {
    metrics.timings.totalDuration = metrics.timings.instanceStop - metrics.timings.instanceStart;
  }
  
  const report = {
    runDate: new Date().toISOString(),
    instanceId: AWS_INSTANCE_ID,
    instanceType: metrics.instanceType,
    optimizedSettings: metrics.optimizedSettings,
    courses: 'all',
    outputDir: OUTPUT_DIR,
    metrics: {
      timings: {
        instanceStartDuration: formatDuration(metrics.timings.instanceStartDuration),
        sshReadyDuration: formatDuration(metrics.timings.sshReadyDuration),
        cookieValidationDuration: formatDuration(metrics.timings.cookieValidationDuration),
        mappingDuration: formatDuration(metrics.timings.mappingDuration),
        extractionDuration: formatDuration(metrics.timings.extractionDuration),
        downloadDuration: formatDuration(metrics.timings.downloadDuration),
        instanceStopDuration: formatDuration(metrics.timings.instanceStopDuration),
        totalDuration: formatDuration(metrics.timings.totalDuration)
      },
      concurrency: {
        maxConcurrent: metrics.concurrency.maxConcurrent,
        averageConcurrent: Math.round(metrics.concurrency.averageConcurrent),
        sampleCount: metrics.concurrency.samples.length
      },
      errors: metrics.errors,
      rateLimiting: metrics.rateLimiting,
      requests: metrics.requests,
      cloudWatch: metrics.cloudWatch ? {
        cpu: metrics.cloudWatch.cpu ? {
          average: metrics.cloudWatch.cpu.average ? `${metrics.cloudWatch.cpu.average.toFixed(2)}%` : null,
          maximum: metrics.cloudWatch.cpu.maximum ? `${metrics.cloudWatch.cpu.maximum.toFixed(2)}%` : null,
          minimum: metrics.cloudWatch.cpu.minimum ? `${metrics.cloudWatch.cpu.minimum.toFixed(2)}%` : null,
          samples: metrics.cloudWatch.cpu.samples
        } : null,
        memory: metrics.cloudWatch.memory ? {
          available: metrics.cloudWatch.memory.available,
          average: metrics.cloudWatch.memory.average ? `${metrics.cloudWatch.memory.average.toFixed(2)}%` : null,
          maximum: metrics.cloudWatch.memory.maximum ? `${metrics.cloudWatch.memory.maximum.toFixed(2)}%` : null,
          minimum: metrics.cloudWatch.memory.minimum ? `${metrics.cloudWatch.memory.minimum.toFixed(2)}%` : null,
          samples: metrics.cloudWatch.memory.samples
        } : null,
        network: metrics.cloudWatch.network ? {
          networkIn: {
            total: `${(metrics.cloudWatch.network.networkIn.total / 1024 / 1024).toFixed(2)} MB`,
            average: `${(metrics.cloudWatch.network.networkIn.average / 1024 / 1024).toFixed(2)} MB/min`,
            samples: metrics.cloudWatch.network.networkIn.samples
          },
          networkOut: {
            total: `${(metrics.cloudWatch.network.networkOut.total / 1024 / 1024).toFixed(2)} MB`,
            average: `${(metrics.cloudWatch.network.networkOut.average / 1024 / 1024).toFixed(2)} MB/min`,
            samples: metrics.cloudWatch.network.networkOut.samples
          }
        } : null,
        collectionTime: metrics.cloudWatch.collectionTime,
        timeRange: metrics.cloudWatch.timeRange
      } : null
    }
  };
  
  // Save metrics.json inside the extraction folder if provided, otherwise use default location
  let reportPath;
  if (extractionFolder) {
    const extractionPath = path.join(__dirname, '..', OUTPUT_BASE_DIR, extractionFolder);
    // Ensure the extraction folder exists
    if (!fs.existsSync(extractionPath)) {
      fs.mkdirSync(extractionPath, { recursive: true });
    }
    reportPath = path.join(extractionPath, 'metrics.json');
  } else {
    // Fallback: try to find the latest extraction folder locally
    const datasetsPath = path.join(__dirname, '..', OUTPUT_BASE_DIR);
    if (fs.existsSync(datasetsPath)) {
      const folders = fs.readdirSync(datasetsPath)
        .filter(f => fs.statSync(path.join(datasetsPath, f)).isDirectory() && f.startsWith('extraction-'))
        .sort()
        .reverse();
      if (folders.length > 0) {
        const latestFolder = folders[0];
        reportPath = path.join(datasetsPath, latestFolder, 'metrics.json');
        console.log(`   📁 Using latest extraction folder: ${latestFolder}`);
      } else {
        reportPath = path.join(__dirname, '..', OUTPUT_DIR, 'metrics.json');
      }
    } else {
      reportPath = path.join(__dirname, '..', OUTPUT_DIR, 'metrics.json');
    }
  }
  
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📊 Metrics report saved to: ${reportPath}`);
  
  // Print summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 EXTRACTION METRICS SUMMARY');
  console.log(`${'='.repeat(60)}`);
  console.log(`\n🖥️  Instance:`);
  console.log(`   Type: ${metrics.instanceType}`);
  console.log(`   ID: ${AWS_INSTANCE_ID}`);
  console.log(`\n⚙️  Optimized Settings:`);
  console.log(`   Max Concurrency: ${metrics.optimizedSettings.maxConcurrency}`);
  console.log(`   Parallel Courses: ${metrics.optimizedSettings.parallelLimit}`);
  console.log(`   Max Depth: ${metrics.optimizedSettings.maxDepth}`);
  console.log(`   Max Requests: ${metrics.optimizedSettings.maxRequestsPerCrawl}`);
  console.log(`\n⏱️  Timings:`);
  console.log(`   Instance Start: ${formatDuration(metrics.timings.instanceStartDuration)}`);
  console.log(`   SSH Ready: ${formatDuration(metrics.timings.sshReadyDuration)}`);
  console.log(`   Cookie Validation: ${formatDuration(metrics.timings.cookieValidationDuration)}`);
  console.log(`   Mapping: ${formatDuration(metrics.timings.mappingDuration)}`);
  console.log(`   Extraction: ${formatDuration(metrics.timings.extractionDuration)}`);
  console.log(`   Download: ${formatDuration(metrics.timings.downloadDuration)}`);
  console.log(`   Instance Stop: ${formatDuration(metrics.timings.instanceStopDuration)}`);
  console.log(`   Total: ${formatDuration(metrics.timings.totalDuration)}`);
  console.log(`\n🔄 Concurrency:`);
  console.log(`   Max Concurrent: ${metrics.concurrency.maxConcurrent}`);
  console.log(`   Average Concurrent: ${Math.round(metrics.concurrency.averageConcurrent)}`);
  console.log(`   Samples: ${metrics.concurrency.samples.length}`);
  
  // Print CloudWatch metrics if available
  if (metrics.cloudWatch && !metrics.cloudWatch.error) {
    console.log(`\n💻 CloudWatch Resource Utilization:`);
    if (metrics.cloudWatch.cpu && metrics.cloudWatch.cpu.samples > 0) {
      console.log(`   CPU:`);
      console.log(`      Average: ${metrics.cloudWatch.cpu.average?.toFixed(2) || 'N/A'}%`);
      console.log(`      Maximum: ${metrics.cloudWatch.cpu.maximum?.toFixed(2) || 'N/A'}%`);
      console.log(`      Minimum: ${metrics.cloudWatch.cpu.minimum?.toFixed(2) || 'N/A'}%`);
      console.log(`      Samples: ${metrics.cloudWatch.cpu.samples}`);
    }
    if (metrics.cloudWatch.memory) {
      if (metrics.cloudWatch.memory.available && metrics.cloudWatch.memory.samples > 0) {
        console.log(`   Memory:`);
        console.log(`      Average: ${metrics.cloudWatch.memory.average?.toFixed(2) || 'N/A'}%`);
        console.log(`      Maximum: ${metrics.cloudWatch.memory.maximum?.toFixed(2) || 'N/A'}%`);
        console.log(`      Minimum: ${metrics.cloudWatch.memory.minimum?.toFixed(2) || 'N/A'}%`);
        console.log(`      Samples: ${metrics.cloudWatch.memory.samples}`);
      } else {
        console.log(`   Memory: Not available (CloudWatch agent not installed)`);
      }
    }
    if (metrics.cloudWatch.network) {
      console.log(`   Network:`);
      console.log(`      In: ${(metrics.cloudWatch.network.networkIn.total / 1024 / 1024).toFixed(2)} MB total`);
      console.log(`      Out: ${(metrics.cloudWatch.network.networkOut.total / 1024 / 1024).toFixed(2)} MB total`);
    }
  } else if (metrics.cloudWatch && metrics.cloudWatch.error) {
    console.log(`\n⚠️  CloudWatch Metrics: ${metrics.cloudWatch.error}`);
  }
  
  console.log(`\n❌ Errors:`);
  console.log(`   Authentication: ${metrics.errors.authentication}`);
  console.log(`   Network: ${metrics.errors.network}`);
  console.log(`   Timeout: ${metrics.errors.timeout}`);
  console.log(`   Other: ${metrics.errors.other}`);
  console.log(`   Total: ${metrics.errors.total}`);
  console.log(`\n🚦 Rate Limiting:`);
  console.log(`   Rate Limit Hits: ${metrics.rateLimiting.rateLimitHits}`);
  console.log(`   Retries: ${metrics.rateLimiting.retries}`);
  console.log(`   Backoff Events: ${metrics.rateLimiting.backoffEvents}`);
  console.log(`\n📡 Requests:`);
  console.log(`   Total: ${metrics.requests.total}`);
  console.log(`   Successful: ${metrics.requests.successful}`);
  console.log(`   Failed: ${metrics.requests.failed}`);
  console.log(`   Retried: ${metrics.requests.retried}`);
  console.log(`\n📁 Output Directory: ${OUTPUT_DIR}`);
  console.log(`${'='.repeat(60)}\n`);
}

/**
 * Main execution
 */
async function main() {
  const overallStart = Date.now();
  
  try {
    console.log('🚀 AWS Extraction Runner - Optimized Full Extraction');
    console.log('='.repeat(60));
    console.log(`   Instance ID: ${AWS_INSTANCE_ID}`);
    console.log(`   Region: ${AWS_REGION}`);
    console.log(`   Courses: ALL`);
    console.log(`   Output: ${OUTPUT_BASE_DIR}/extraction-{timestamp}/`);
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
    trackTiming('instanceStart');
    
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
    
    trackTiming('instanceStart', instanceStartTime);
    
    const { publicIp, wasAlreadyRunning } = instanceResult;
    
    // SSH is already tested in ensureInstanceReady, but track timing
    trackTiming('sshReady', instanceStartTime);
    
    console.log('✅ Instance is running and SSH is ready');
    
    // Step 2: Get instance type and optimize settings
    console.log('\n📋 Step 2: Detecting instance type and optimizing settings...');
    const instanceDetails = await getInstanceDetails(AWS_INSTANCE_ID);
    
    if (!instanceDetails || !instanceDetails.instanceType) {
      console.error('❌ Could not determine instance type');
      process.exit(1);
    }
    
    console.log(`   Instance Type: ${instanceDetails.instanceType}`);
    const settings = optimizeSettings(instanceDetails.instanceType);
    console.log(`   ✅ Optimized Settings:`);
    console.log(`      Max Concurrency: ${settings.maxConcurrency}`);
    console.log(`      Parallel Courses: ${settings.parallelLimit}`);
    console.log(`      Max Depth: ${settings.maxDepth}`);
    console.log(`      Max Requests: ${settings.maxRequestsPerCrawl}`);
    
    // Step 3: Sync code and cookies to instance
    console.log('\n📋 Step 3: Syncing code and cookies to AWS instance...');
    await syncCodeToInstance(publicIp, AWS_KEY_FILE);
    await syncCookiesToInstance(publicIp, AWS_KEY_FILE);
    
    // Step 4: Validate cookies
    console.log('\n📋 Step 4: Validating cookies...');
    const cookieValidation = await validateCookies(publicIp, AWS_KEY_FILE);
    
    if (!cookieValidation.success) {
      console.error('❌ Cookie validation failed');
      process.exit(1);
    }
    
    if (!cookieValidation.valid) {
      console.error('❌ Cookies are invalid. Please extract new cookies.');
      console.error('   Run locally: npm run auth:extract-cookies');
      console.error('   Then re-run this extraction to sync the new cookies.');
      process.exit(1);
    }
    
    console.log('✅ Cookies are valid');
    
    // Step 5: Start monitoring
    startMonitoring(publicIp, AWS_KEY_FILE);
    
    // Step 6: Run complete extraction (mapping + extraction + downloads) on AWS
    console.log('\n📋 Step 6: Running complete extraction on AWS (mapping + extraction + downloads)...');
    const fullExtractionResult = await runFullExtractionOnAWS(publicIp, AWS_KEY_FILE, settings);
    
    if (!fullExtractionResult.success) {
      console.error(`❌ Full extraction failed: ${fullExtractionResult.error || 'Unknown error'}`);
      console.error(`   Exit code: ${fullExtractionResult.exitCode}`);
    } else {
      console.log('✅ Full extraction completed (mapping + extraction + downloads)');
    }
    
    // Step 7: Generate extraction summary on AWS
    console.log('\n📋 Step 7: Generating extraction summary...');
    let latestExtractionFolder = null;
    try {
      latestExtractionFolder = await findLatestExtractionFolder(publicIp, AWS_KEY_FILE);
      if (!latestExtractionFolder) {
        console.error('   ❌ Could not determine extraction folder for summary generation');
      } else {
        const summaryResult = await generateExtractionSummaryOnAWS(publicIp, AWS_KEY_FILE, latestExtractionFolder);
        if (!summaryResult.success) {
          console.error(`   ⚠️ Extraction summary generation failed: ${summaryResult.error}`);
        }
      }
    } catch (summaryError) {
      console.error(`   ⚠️ Extraction summary step failed: ${summaryError.message}`);
    }

    // Step 8: Download results from AWS (with timeout)
    console.log('\n📋 Step 8: Downloading results from AWS...');
    try {
      await downloadResults(publicIp, AWS_KEY_FILE, latestExtractionFolder);
    } catch (downloadError) {
      console.error(`❌ Download failed: ${downloadError.error || downloadError.message}`);
      console.error('   Results may still be on the instance');
      console.error('   Continuing with instance shutdown...');
    }
    
    // Step 9: Collect CloudWatch metrics (before stopping instance)
    console.log('\n📊 Step 9: Collecting CloudWatch metrics...');
    try {
      const extractionEndTime = new Date();
      // Collect metrics for the entire extraction period (from instance start to now)
      const metricsStartTime = new Date(overallStart);
      // Add a small buffer to ensure we capture all metrics
      const metricsEndTime = new Date(extractionEndTime.getTime() + 60000); // 1 minute buffer
      
      // Add timeout for CloudWatch metrics collection (2 minutes max)
      const cloudWatchMetrics = await Promise.race([
        collectMetrics(AWS_INSTANCE_ID, metricsStartTime, metricsEndTime),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('CloudWatch metrics collection timeout after 2 minutes')), 120000)
        )
      ]);
      metrics.cloudWatch = cloudWatchMetrics;
      
      console.log('✅ CloudWatch metrics collected');
      if (cloudWatchMetrics.cpu.samples > 0) {
        console.log(`   CPU Utilization: Avg ${cloudWatchMetrics.cpu.average?.toFixed(1) || 'N/A'}%, Max ${cloudWatchMetrics.cpu.maximum?.toFixed(1) || 'N/A'}%`);
      }
      if (cloudWatchMetrics.memory.available) {
        console.log(`   Memory Utilization: Avg ${cloudWatchMetrics.memory.average?.toFixed(1) || 'N/A'}%, Max ${cloudWatchMetrics.memory.maximum?.toFixed(1) || 'N/A'}%`);
      } else {
        console.log(`   Memory Utilization: Not available (CloudWatch agent not installed)`);
      }
      if (cloudWatchMetrics.network) {
        console.log(`   Network: ${(cloudWatchMetrics.network.networkIn.total / 1024 / 1024).toFixed(2)} MB in, ${(cloudWatchMetrics.network.networkOut.total / 1024 / 1024).toFixed(2)} MB out`);
      }
    } catch (error) {
      console.error(`⚠️  Failed to collect CloudWatch metrics: ${error.message}`);
      metrics.cloudWatch = {
        error: error.message,
        collectionTime: new Date().toISOString()
      };
    }
    
    // Step 10: Hibernate instance
    console.log('\n📋 Step 10: Hibernating AWS instance...');
    const instanceStopTime = Date.now();
    trackTiming('instanceStop');
    
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
    
    trackTiming('instanceStop', instanceStopTime);
    
    if (!cleanupResult.success) {
      console.error(`⚠️  Failed to hibernate instance: ${cleanupResult.error}`);
      console.error('   Please hibernate the instance manually to avoid charges!');
    } else {
      console.log('✅ Instance hibernated successfully');
    }
    
    // Step 11: Generate metrics report
    saveMetricsReport(latestExtractionFolder);
    
    const overallDuration = Date.now() - overallStart;
    console.log(`\n✅ Full extraction completed in ${formatDuration(overallDuration)}`);
    console.log(`📁 Results saved to: ${OUTPUT_DIR}`);
    
    process.exit(0);
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
