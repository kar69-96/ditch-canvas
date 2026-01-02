#!/usr/bin/env node
/**
 * Quick script to add Notion credentials to .env
 * Usage: node scripts/add-notion-credentials.js <client-id> <client-secret> <page-id>
 */

const fs = require('fs');
const path = require('path');

// Load .env from root directory (one level up from backend/)
const ENV_FILE = path.join(__dirname, '..', '..', '.env');
require('dotenv').config({ path: ENV_FILE });

if (process.argv.length < 5) {
  console.log('Usage: node scripts/add-notion-credentials.js <client-id> <client-secret> <page-id>');
  console.log('\nExample:');
  console.log('  node scripts/add-notion-credentials.js abc123...xyz secret_abc...xyz abc123def456...xyz789');
  process.exit(1);
}

const [,, clientId, clientSecret, pageId] = process.argv;

// Validate page ID format (should be 32 chars, can have dashes)
if (pageId.replace(/-/g, '').length !== 32) {
  console.error('⚠️  Warning: Page ID should be 32 characters (dashes are OK)');
  console.error(`   Got: ${pageId.length} characters`);
}

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
envContent = envContent.replace(
  /^NOTION_PARENT_PAGE_ID=.*$/m,
  `NOTION_PARENT_PAGE_ID=${pageId}`
);

fs.writeFileSync(ENV_FILE, envContent, 'utf8');

console.log('✅ Notion credentials added to .env');
console.log('\n📋 Summary:');
console.log(`   Client ID: ${clientId.substring(0, 20)}...`);
console.log(`   Client Secret: ${clientSecret.substring(0, 20)}...`);
console.log(`   Page ID: ${pageId}`);
console.log('\n🚀 Next: Restart your backend server');

