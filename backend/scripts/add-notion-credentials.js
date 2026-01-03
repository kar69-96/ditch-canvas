#!/usr/bin/env node
/**
 * Quick script to add Notion credentials to .env
 * Usage: node scripts/add-notion-credentials.js <client-id> <client-secret> [page-id]
 * 
 * Note: page-id is optional. Each user will provide their own page ID when connecting.
 */

const fs = require('fs');
const path = require('path');

// Load .env from root directory (one level up from backend/)
const ENV_FILE = path.join(__dirname, '..', '..', '.env');
require('dotenv').config({ path: ENV_FILE });

if (process.argv.length < 4) {
  console.log('Usage: node scripts/add-notion-credentials.js <client-id> <client-secret> [page-id]');
  console.log('\nExample:');
  console.log('  node scripts/add-notion-credentials.js abc123...xyz secret_abc...xyz');
  console.log('  node scripts/add-notion-credentials.js abc123...xyz secret_abc...xyz abc123def456...xyz789');
  console.log('\nNote: page-id is optional. Users will provide their own page ID when connecting.');
  process.exit(1);
}

const [,, clientId, clientSecret, pageId] = process.argv;

let envContent = fs.readFileSync(ENV_FILE, 'utf8');

// Replace the placeholder values
envContent = envContent.replace(
  /^NOTION_CLIENT_ID=.*$/m,
  `NOTION_CLIENT_ID=${clientId}`
);
envContent = envContent.replace(
  /^NOTION_CLIENT_SECRET=.*$/m,
  `NOTION_CLIENT_SECRET=${clientSecret}`
);

// Only set page ID if provided (optional)
if (pageId) {
  // Validate page ID format (should be 32 chars, can have dashes)
  if (pageId.replace(/-/g, '').length !== 32) {
    console.error('⚠️  Warning: Page ID should be 32 characters (dashes are OK)');
    console.error(`   Got: ${pageId.length} characters`);
  }
  envContent = envContent.replace(
    /^NOTION_PARENT_PAGE_ID=.*$/m,
    `NOTION_PARENT_PAGE_ID=${pageId}`
  );
  // If the line doesn't exist, append it
  if (!envContent.includes('NOTION_PARENT_PAGE_ID=')) {
    envContent += `\nNOTION_PARENT_PAGE_ID=${pageId}`;
  }
} else {
  console.log('ℹ️  No page ID provided. Each user will provide their own page ID when connecting.');
}

fs.writeFileSync(ENV_FILE, envContent, 'utf8');

console.log('✅ Notion credentials added to .env');
console.log('\n📋 Summary:');
console.log(`   Client ID: ${clientId.substring(0, 20)}...`);
console.log(`   Client Secret: ${clientSecret.substring(0, 20)}...`);
if (pageId) {
  console.log(`   Page ID (optional fallback): ${pageId}`);
}
console.log('\n🚀 Next: Restart your backend server');
console.log('   Each user will provide their own Notion page ID when connecting.');

