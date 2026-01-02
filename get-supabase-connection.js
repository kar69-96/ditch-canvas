#!/usr/bin/env node
/**
 * Helper script to get the correct Supabase connection string format
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;

if (!SUPABASE_URL) {
  console.error('❌ Missing SUPABASE_URL in .env');
  process.exit(1);
}

const urlMatch = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/);
if (!urlMatch) {
  console.error('❌ Invalid SUPABASE_URL format');
  process.exit(1);
}
const projectRef = urlMatch[1];

console.log('📋 Supabase Connection Information\n');
console.log('Project Ref:', projectRef);
console.log('Password Length:', SUPABASE_DB_PASSWORD ? SUPABASE_DB_PASSWORD.length : 'NOT SET');
console.log('\n🔗 Get your connection string from:');
console.log('   https://supabase.com/dashboard/project/' + projectRef + '/settings/database\n');
console.log('Look for one of these sections:');
console.log('   - "Connection string" (URI format)');
console.log('   - "Connection pooling" (Session mode)');
console.log('   - "Direct connection"\n');
console.log('Copy the FULL connection string and use it directly.\n');
console.log('Or run the migration manually in SQL Editor:');
console.log('   https://supabase.com/dashboard/project/' + projectRef + '/sql/new\n');




