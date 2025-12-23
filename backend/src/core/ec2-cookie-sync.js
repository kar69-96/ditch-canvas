#!/usr/bin/env node
/**
 * Utility module for syncing cookies between EC2 instance and local machine
 */

const path = require('path');
const fs = require('fs');
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

/**
 * Download cookies from EC2 instance to local machine
 * @param {string} publicIp - EC2 instance public IP
 * @param {string} keyFile - Path to SSH key file
 * @param {string} sshUser - SSH username (default: ec2-user)
 * @param {string} remoteCookieFile - Remote cookie file path (default: ~/canvas-wrapper-data/auth/canvas-cookies.json)
 * @param {string} localCookieFile - Local cookie file path (optional, defaults to backend/data/auth/canvas-cookies.json)
 * @returns {Promise<boolean>} - True if download was successful
 */
async function downloadCookiesFromEC2(publicIp, keyFile, sshUser = 'ec2-user', remoteCookieFile = '~/canvas-wrapper-data/auth/canvas-cookies.json', localCookieFile = null) {
  // Default local cookie file path
  if (!localCookieFile) {
    localCookieFile = path.join(__dirname, '..', '..', 'data', 'auth', 'canvas-cookies.json');
  }
  
  const localCookieDir = path.dirname(localCookieFile);
  
  // Ensure local directory exists
  if (!fs.existsSync(localCookieDir)) {
    fs.mkdirSync(localCookieDir, { recursive: true });
  }
  
  console.log('\n📥 Downloading cookies from EC2...');
  
  try {
    // Check if remote file exists
    const checkResult = await execWithTimeout(
      `ssh -i "${keyFile}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 ${sshUser}@${publicIp} "test -f ${remoteCookieFile} && echo 'EXISTS' || echo 'NOT_FOUND'"`,
      10000
    );
    
    if (checkResult.stdout.trim() === 'NOT_FOUND') {
      console.log('⚠️  Cookie file not found on EC2. It may not have been saved yet.');
      return false;
    }
    
    // Download the file using scp
    await execWithTimeout(
      `scp -i "${keyFile}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 ${sshUser}@${publicIp}:${remoteCookieFile} "${localCookieFile}"`,
      30000
    );
    
    // Verify the file was downloaded
    if (fs.existsSync(localCookieFile)) {
      const cookieData = JSON.parse(fs.readFileSync(localCookieFile, 'utf8'));
      const extractedAt = cookieData.metadata?.extractedAt || 'unknown';
      console.log(`✅ Cookies downloaded successfully!`);
      console.log(`   Extracted at: ${extractedAt}`);
      console.log(`   Saved to: ${localCookieFile}`);
      return true;
    } else {
      console.log('⚠️  Download completed but file not found locally');
      return false;
    }
  } catch (error) {
    console.error(`❌ Failed to download cookies: ${error.message}`);
    return false;
  }
}

/**
 * Upload cookies from local machine to EC2 instance
 * @param {string} publicIp - EC2 instance public IP
 * @param {string} keyFile - Path to SSH key file
 * @param {string} sshUser - SSH username (default: ec2-user)
 * @param {string} localCookieFile - Local cookie file path (optional, defaults to backend/data/auth/canvas-cookies.json)
 * @param {string} remoteCookieFile - Remote cookie file path (default: ~/canvas-wrapper-data/auth/canvas-cookies.json)
 * @returns {Promise<boolean>} - True if upload was successful
 */
async function uploadCookiesToEC2(publicIp, keyFile, sshUser = 'ec2-user', localCookieFile = null, remoteCookieFile = '~/canvas-wrapper-data/auth/canvas-cookies.json') {
  // Default local cookie file path
  if (!localCookieFile) {
    localCookieFile = path.join(__dirname, '..', '..', 'data', 'auth', 'canvas-cookies.json');
  }
  
  if (!fs.existsSync(localCookieFile)) {
    console.log('⚠️  Local cookie file not found, skipping upload');
    return false;
  }
  
  console.log('\n📤 Uploading cookies to EC2...');
  
  try {
    // Ensure remote directory exists
    const remoteDir = path.dirname(remoteCookieFile.replace('~', ''));
    await execWithTimeout(
      `ssh -i "${keyFile}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 ${sshUser}@${publicIp} "mkdir -p ${remoteDir}"`,
      15000
    );
    
    // Upload the file using scp
    await execWithTimeout(
      `scp -i "${keyFile}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 "${localCookieFile}" ${sshUser}@${publicIp}:${remoteCookieFile}`,
      30000
    );
    
    console.log(`✅ Cookies uploaded successfully to EC2!`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to upload cookies: ${error.message}`);
    return false;
  }
}

module.exports = {
  downloadCookiesFromEC2,
  uploadCookiesToEC2
};


