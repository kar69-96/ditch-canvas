#!/usr/bin/env node

/**
 * Display the SQL migration file with instructions
 * Makes it easy to copy and paste into Supabase SQL Editor
 * 
 * Usage: node supabase/show-migration.js
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const migrationFile = join(__dirname, 'migrations', '001_create_users_and_sessions.sql');

console.log('\n📋 Supabase SQL Migration');
console.log('═'.repeat(60));
console.log('\n📁 File:', migrationFile);
console.log('\n📝 SQL to copy:\n');
console.log('─'.repeat(60));

try {
  const sql = readFileSync(migrationFile, 'utf-8');
  console.log(sql);
  console.log('─'.repeat(60));
  
  console.log('\n🚀 Next Steps:');
  console.log('   1. Copy the SQL above (between the lines)');
  console.log('   2. Go to: https://supabase.com/dashboard');
  console.log('   3. Select your project');
  console.log('   4. Navigate to: SQL Editor');
  console.log('   5. Click "New query"');
  console.log('   6. Paste the SQL');
  console.log('   7. Click "Run" (or press Cmd/Ctrl + Enter)');
  console.log('   8. Verify tables in: Table Editor\n');
  
  console.log('💡 Tip: You can edit the SQL file directly:');
  console.log(`   ${migrationFile}\n`);
  
} catch (error) {
  console.error('❌ Error reading migration file:', error.message);
  process.exit(1);
}

