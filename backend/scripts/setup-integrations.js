#!/usr/bin/env node
/**
 * Integration Setup Helper Script
 * Generates encryption key and validates environment variables
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Load .env from root directory (one level up from backend/)
const ENV_FILE = path.join(__dirname, '..', '..', '.env');
require('dotenv').config({ path: ENV_FILE });
const ENV_EXAMPLE = path.join(__dirname, '..', '.env.example');

console.log('🔧 Integration Setup Helper\n');

// Generate encryption key
function generateEncryptionKey() {
  return crypto.randomBytes(32).toString('hex');
}

// Check if .env file exists
const envExists = fs.existsSync(ENV_FILE);
let envContent = '';

if (envExists) {
  envContent = fs.readFileSync(ENV_FILE, 'utf8');
  console.log('✅ Found .env file\n');
} else {
  console.log('⚠️  No .env file found. Will create one.\n');
}

// Required variables for integrations
const requiredVars = {
  // Google
  GOOGLE_CLIENT_ID: 'Your Google OAuth Client ID',
  GOOGLE_CLIENT_SECRET: 'Your Google OAuth Client Secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:3000/api/integrations/google/callback',
  
  // Notion
  NOTION_CLIENT_ID: 'Your Notion OAuth Client ID',
  NOTION_CLIENT_SECRET: 'Your Notion OAuth Client Secret',
  NOTION_REDIRECT_URI: 'http://localhost:3000/api/integrations/notion/callback',
  NOTION_PARENT_PAGE_ID: 'Your Notion page ID (32 characters)',
  
  // Encryption
  INTEGRATIONS_TOKEN_ENC_KEY: generateEncryptionKey(),
  
  // Supabase (if not already set)
  SUPABASE_URL: 'https://your-project.supabase.co',
  SUPABASE_SERVICE_KEY: 'your-service-role-key',
};

console.log('📋 Checking environment variables...\n');

const missing = [];
const present = [];
const toAdd = [];

// Check each required variable
for (const [key, defaultValue] of Object.entries(requiredVars)) {
  const regex = new RegExp(`^${key}=`, 'm');
  if (regex.test(envContent)) {
    present.push(key);
    console.log(`  ✅ ${key} - already set`);
  } else {
    missing.push(key);
    toAdd.push(`${key}=${defaultValue}`);
    if (key === 'INTEGRATIONS_TOKEN_ENC_KEY') {
      console.log(`  ⚠️  ${key} - MISSING (will generate)`);
    } else {
      console.log(`  ❌ ${key} - MISSING`);
    }
  }
}

console.log('\n');

// Generate encryption key if missing
if (missing.includes('INTEGRATIONS_TOKEN_ENC_KEY')) {
  const key = generateEncryptionKey();
  console.log(`🔑 Generated encryption key: ${key.substring(0, 16)}...`);
  console.log('   (Full key will be added to .env)\n');
}

// Add missing variables to .env
if (toAdd.length > 0) {
  console.log('📝 Adding missing variables to .env file...\n');
  
  let newContent = envContent;
  if (!envContent.endsWith('\n') && envContent.length > 0) {
    newContent += '\n';
  }
  
  // Add section header
  if (toAdd.length > 1) {
    newContent += '\n# ============================================\n';
    newContent += '# Integration Settings\n';
    newContent += '# ============================================\n';
  }
  
  // Add each missing variable
  toAdd.forEach(line => {
    newContent += line + '\n';
  });
  
  // Write to file
  fs.writeFileSync(ENV_FILE, newContent, 'utf8');
  console.log('✅ Updated .env file\n');
} else {
  console.log('✅ All integration variables are set!\n');
}

// Summary
console.log('📊 Summary:\n');
console.log(`  ✅ Present: ${present.length}/${Object.keys(requiredVars).length}`);
console.log(`  ⚠️  Missing: ${missing.length}/${Object.keys(requiredVars).length}`);

if (missing.length > 0 && !missing.includes('INTEGRATIONS_TOKEN_ENC_KEY')) {
  console.log('\n⚠️  Action Required:\n');
  console.log('   You still need to set up:');
  missing.forEach(key => {
    if (key !== 'INTEGRATIONS_TOKEN_ENC_KEY') {
      console.log(`   - ${key}`);
    }
  });
  console.log('\n   See docs/INTEGRATIONS_INTERACTIVE_SETUP.md for instructions.\n');
}

// Next steps
console.log('🚀 Next Steps:\n');
console.log('   1. Complete Notion OAuth setup:');
console.log('      - Go to: https://www.notion.so/my-integrations');
console.log('      - Create a new integration (Public type)');
console.log('      - Copy OAuth Client ID and Secret');
console.log('      - Add redirect URI: http://localhost:3000/api/integrations/notion/callback');
console.log('      - Get a Notion page ID from any page URL');
console.log('      - Update .env with these values\n');
console.log('   2. Verify Supabase credentials are set in .env\n');
console.log('   3. Restart your backend server\n');
console.log('   4. Test the integration from the Calendar page\n');

