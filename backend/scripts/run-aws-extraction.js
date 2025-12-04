#!/usr/bin/env node
/**
 * AWS Extraction Runner with Detailed Metrics Tracking
 * Runs extraction on AWS EC2 instance with comprehensive monitoring
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

const { ensureInstanceReady, executeCommand, cleanup } = require('../src/utils/aws-ec2-manager.js');
const { spawn } = require('child_process');

// Configuration
const AWS_INSTANCE_ID = process.env.AWS_INSTANCE_ID;
const AWS_KEY_FILE = process.env.AWS_KEY_FILE || path.join(__dirname, '..', 'Canvas-Wrapper.pem');
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const EXTRACT_COURSES = process.env.EXTRACT_COURSES || '121531,123156,123160,123236,123249,124722';
const OUTPUT_DIR = 'storage/datasets/AWS Test Extractions/Test 2';

// Metrics tracking
const metrics = {
  timings: {
    instanceStart: null,
    instanceStartDuration: 0,
    sshReady: null,
    sshReadyDuration: 0,
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
  }
};

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
    // Track authentication errors
    if (line.includes('401') || line.includes('Unauthorized') || line.includes('authentication')) {
      metrics.errors.authentication++;
      metrics.errors.total++;
    }
    
    // Track network errors
    if (line.includes('ETIMEDOUT') || line.includes('ECONNRESET') || line.includes('network')) {
      metrics.errors.network++;
      metrics.errors.total++;
    }
    
    // Track timeouts
    if (line.includes('timeout') || line.includes('Timeout')) {
      metrics.errors.timeout++;
      metrics.errors.total++;
    }
    
    // Track rate limiting
    if (line.includes('429') || line.includes('rate limit') || line.includes('Too Many Requests')) {
      metrics.rateLimiting.rateLimitHits++;
    }
    
    // Track retries
    if (line.includes('retry') || line.includes('Retry')) {
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
 * Download results from AWS instance
 */
async function downloadResults(publicIp, keyFile) {
  trackTiming('downloadStart');
  
  const remotePath = '~/Canvas-Wrapper/storage/datasets/full-extraction';
  const localPath = path.join(__dirname, '..', OUTPUT_DIR);
  
  // Ensure local directory exists
  if (!fs.existsSync(localPath)) {
    fs.mkdirSync(localPath, { recursive: true });
  }
  
  console.log(`\n📥 Downloading results from AWS instance...`);
  console.log(`   Remote: ${remotePath}`);
  console.log(`   Local: ${localPath}`);
  
  return new Promise((resolve, reject) => {
    const sshUser = process.env.AWS_SSH_USER || 'ec2-user';
    const rsyncCommand = [
      '-avz',
      '--progress',
      '-e', `ssh -i "${keyFile}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`,
      `${sshUser}@${publicIp}:${remotePath}/`,
      `${localPath}/`
    ];
    
    const rsync = spawn('rsync', rsyncCommand, {
      stdio: 'inherit'
    });
    
    rsync.on('close', (code) => {
      trackTiming('downloadEnd', metrics.timings.downloadStart);
      if (code === 0) {
        console.log('✅ Results downloaded successfully');
        resolve({ success: true });
      } else {
        console.error(`❌ Download failed with exit code ${code}`);
        reject({ success: false, exitCode: code });
      }
    });
    
    rsync.on('error', (error) => {
      console.error(`❌ Download error: ${error.message}`);
      reject({ success: false, error: error.message });
    });
  });
}

/**
 * Run extraction on AWS instance
 */
async function runExtraction(publicIp, keyFile) {
  trackTiming('extractionStart');
  
  console.log(`\n🚀 Starting extraction on AWS instance...`);
  console.log(`   Courses: ${EXTRACT_COURSES}`);
  console.log(`   Output: ${OUTPUT_DIR}`);
  
  // Set up environment for full extraction (mapping + extraction + downloads)
  // Always runs from scratch - mapping first, then extraction
  const extractionCommand = [
    'cd ~/Canvas-Wrapper &&',
    'export AWS_INSTANCE_TYPE=r7i.2xlarge &&',
    'export EXTRACT_COURSES=' + EXTRACT_COURSES + ' &&',
    'export SKIP_DOWNLOADS=true &&', // Skip downloads on AWS, download results locally
    'export HEADLESS=true &&',
    'export AWS_INSTANCE_ID=' + AWS_INSTANCE_ID + ' &&',
    'npm run crawl:canvas 2>&1 | tee /tmp/extraction.log'
  ].join(' ');
  
  console.log(`\n📋 Running command on AWS instance...`);
  console.log(`   ${extractionCommand.replace(/export [A-Z_]+=[^&]+ &&/g, '').replace(/npm run/, 'npm run')}`);
  
  const result = await executeCommand(publicIp, extractionCommand, keyFile);
  
  trackTiming('extractionEnd', metrics.timings.extractionStart);
  
  // Parse output for metrics
  if (result.stdout) {
    parseCrawlerOutput(result.stdout);
  }
  if (result.stderr) {
    parseCrawlerOutput(result.stderr);
  }
  
  // Also try to get the log file
  try {
    const logResult = await executeCommand(publicIp, 'cat /tmp/extraction.log', keyFile);
    if (logResult.stdout) {
      parseCrawlerOutput(logResult.stdout);
    }
  } catch (e) {
    console.log('⚠️  Could not read extraction log file');
  }
  
  return result;
}

/**
 * Generate and save metrics report
 */
function saveMetricsReport() {
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
    courses: EXTRACT_COURSES.split(','),
    metrics: {
      timings: {
        instanceStartDuration: formatDuration(metrics.timings.instanceStartDuration),
        sshReadyDuration: formatDuration(metrics.timings.sshReadyDuration),
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
      requests: metrics.requests
    }
  };
  
  const reportPath = path.join(__dirname, '..', OUTPUT_DIR, 'metrics.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📊 Metrics report saved to: ${reportPath}`);
  
  // Print summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 EXTRACTION METRICS SUMMARY');
  console.log(`${'='.repeat(60)}`);
  console.log(`\n⏱️  Timings:`);
  console.log(`   Instance Start: ${formatDuration(metrics.timings.instanceStartDuration)}`);
  console.log(`   SSH Ready: ${formatDuration(metrics.timings.sshReadyDuration)}`);
  console.log(`   Extraction: ${formatDuration(metrics.timings.extractionDuration)}`);
  console.log(`   Download: ${formatDuration(metrics.timings.downloadDuration)}`);
  console.log(`   Instance Stop: ${formatDuration(metrics.timings.instanceStopDuration)}`);
  console.log(`   Total: ${formatDuration(metrics.timings.totalDuration)}`);
  console.log(`\n🔄 Concurrency:`);
  console.log(`   Max Concurrent: ${metrics.concurrency.maxConcurrent}`);
  console.log(`   Average Concurrent: ${Math.round(metrics.concurrency.averageConcurrent)}`);
  console.log(`   Samples: ${metrics.concurrency.samples.length}`);
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
  console.log(`${'='.repeat(60)}\n`);
}

/**
 * Main execution
 */
async function main() {
  const overallStart = Date.now();
  
  try {
    console.log('🚀 AWS Extraction Runner with Metrics Tracking');
    console.log('='.repeat(60));
    console.log(`   Instance ID: ${AWS_INSTANCE_ID}`);
    console.log(`   Region: ${AWS_REGION}`);
    console.log(`   Courses: ${EXTRACT_COURSES}`);
    console.log(`   Output: ${OUTPUT_DIR}`);
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
    
    // Step 1: Start instance and wait for SSH
    const instanceStartTime = Date.now();
    trackTiming('instanceStart');
    
    const instanceResult = await ensureInstanceReady(AWS_INSTANCE_ID);
    
    if (!instanceResult.success) {
      console.error(`❌ Failed to start instance: ${instanceResult.error}`);
      process.exit(1);
    }
    
    trackTiming('instanceStart', instanceStartTime);
    trackTiming('sshReady', instanceStartTime);
    
    const { publicIp, wasAlreadyRunning } = instanceResult;
    
    // Step 2: Run extraction
    const extractionResult = await runExtraction(publicIp, AWS_KEY_FILE);
    
    if (!extractionResult.success) {
      console.error(`❌ Extraction failed: ${extractionResult.error || 'Unknown error'}`);
      console.error(`   Exit code: ${extractionResult.exitCode}`);
    }
    
    // Step 3: Download results
    try {
      await downloadResults(publicIp, AWS_KEY_FILE);
    } catch (downloadError) {
      console.error(`❌ Download failed: ${downloadError.error || downloadError.message}`);
      console.error('   Results may still be on the instance');
    }
    
    // Step 4: Stop instance
    const instanceStopTime = Date.now();
    trackTiming('instanceStop');
    
    const cleanupResult = await cleanup(AWS_INSTANCE_ID, wasAlreadyRunning, true);
    
    trackTiming('instanceStop', instanceStopTime);
    
    if (!cleanupResult.success) {
      console.error(`⚠️  Failed to stop instance: ${cleanupResult.error}`);
      console.error('   Please stop the instance manually to avoid charges!');
    }
    
    // Step 5: Generate metrics report
    saveMetricsReport();
    
    const overallDuration = Date.now() - overallStart;
    console.log(`\n✅ Extraction completed in ${formatDuration(overallDuration)}`);
    
  } catch (error) {
    console.error(`\n❌ Fatal error: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    
    // Try to stop instance on error
    try {
      console.log('\n🛑 Attempting to stop instance due to error...');
      await cleanup(AWS_INSTANCE_ID, false, true);
    } catch (cleanupError) {
      console.error(`⚠️  Failed to stop instance: ${cleanupError.message}`);
      console.error('   Please stop the instance manually!');
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

