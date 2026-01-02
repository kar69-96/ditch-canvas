#!/usr/bin/env node
/**
 * Temporary script to apply integrations migration using Supabase database password
 * This script will be deleted after successful migration
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
const SUPABASE_CONNECTION_STRING = process.env.SUPABASE_CONNECTION_STRING;

if (!SUPABASE_URL) {
  console.error('❌ Missing SUPABASE_URL in .env');
  process.exit(1);
}

// Extract project ref from URL
const urlMatch = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/);
if (!urlMatch) {
  console.error('❌ Invalid SUPABASE_URL format');
  process.exit(1);
}
const projectRef = urlMatch[1];

// Read the migration SQL
const migrationPath = path.join(__dirname, 'frontend', 'supabase', 'migrations', '20251225000000_integrations_v3_single_target.sql');
const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

async function applyMigration() {
  console.log('🚀 Applying integrations migration to Supabase...\n');

  let connectionStrings;
  
  // If full connection string is provided, use it directly
  if (SUPABASE_CONNECTION_STRING) {
    connectionStrings = [SUPABASE_CONNECTION_STRING];
    console.log('✅ Using SUPABASE_CONNECTION_STRING from .env\n');
  } else if (!SUPABASE_DB_PASSWORD) {
    console.log('⚠️  Neither SUPABASE_DB_PASSWORD nor SUPABASE_CONNECTION_STRING found in .env');
    console.log('📝 Option 1: Add database password to .env:');
    console.log('   SUPABASE_DB_PASSWORD=your-db-password\n');
    console.log('📝 Option 2: Add full connection string to .env:');
    console.log('   SUPABASE_CONNECTION_STRING=postgresql://...\n');
    console.log('   Get it from: https://supabase.com/dashboard/project/' + projectRef + '/settings/database');
    console.log('   (Look for "Connection string" or "Direct connection")\n');
    console.log('📋 Migration SQL to run manually:');
    console.log('─'.repeat(60));
    console.log(migrationSQL);
    console.log('─'.repeat(60));
    console.log('\n   Or run in SQL Editor:');
    console.log('   https://supabase.com/dashboard/project/' + projectRef + '/sql/new\n');
    process.exit(1);
  } else {
    // URL encode the password in case it has special characters
    const encodedPassword = encodeURIComponent(SUPABASE_DB_PASSWORD);
    
    // Try multiple connection formats
    connectionStrings = [
      // Format 1: Direct connection with project ref in username
      `postgresql://postgres.${projectRef}:${encodedPassword}@db.${projectRef}.supabase.co:5432/postgres`,
      // Format 2: Direct connection without project ref in username
      `postgresql://postgres:${encodedPassword}@db.${projectRef}.supabase.co:5432/postgres`,
      // Format 3: Pooler connection (might work for DDL)
      `postgresql://postgres.${projectRef}:${encodedPassword}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`,
      // Format 4: Pooler without project ref
      `postgresql://postgres:${encodedPassword}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`,
    ];
  }
  
  let client;
  let lastError;
  
  for (let i = 0; i < connectionStrings.length; i++) {
    try {
      console.log(`🔌 Attempting connection (format ${i + 1}/${connectionStrings.length})...`);
      client = new Client({
        connectionString: connectionStrings[i],
        ssl: { 
          rejectUnauthorized: false,
          require: true,
        },
        connect_timeout: 10,
      });
      
      await client.connect();
      console.log('✅ Connected to database\n');
      break;
    } catch (error) {
      lastError = error;
      if (client && !client._ending) {
        try {
          await client.end();
        } catch (_) {}
      }
      if (i === connectionStrings.length - 1) {
        console.error(`❌ Failed with format ${i + 1}: ${error.message}`);
      } else {
        console.log(`   ❌ Format ${i + 1} failed: ${error.message}`);
      }
      continue;
    }
  }
  
  if (!client || client._ending) {
    console.error('\n❌ Failed to connect to database with all connection formats');
    console.error('💡 Troubleshooting steps:');
    console.error('   1. Verify SUPABASE_DB_PASSWORD is correct (no extra spaces/quotes)');
    console.error('   2. Check if password has special characters that need encoding');
    console.error('   3. Go to Supabase dashboard: https://supabase.com/dashboard/project/' + projectRef + '/settings/database');
    console.error('   4. Copy the full connection string and verify the password format');
    console.error('   5. Try resetting the database password if needed\n');
    console.error('📋 Alternative: Run migration manually in SQL Editor:');
    console.error('   https://supabase.com/dashboard/project/' + projectRef + '/sql/new\n');
    process.exit(1);
  }

  try {
    console.log('📝 Executing migration SQL...\n');
    
    // Execute the migration
    await client.query(migrationSQL);
    
    console.log('✅ Migration applied successfully!\n');
    
    // Verify tables were created
    const tablesCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('integrations', 'integration_item_mappings')
      ORDER BY table_name;
    `);
    
    if (tablesCheck.rows.length === 2) {
      console.log('✅ Verified tables created:');
      tablesCheck.rows.forEach(row => {
        console.log(`   - ${row.table_name}`);
      });
      console.log('');
    } else {
      console.log('⚠️  Warning: Some tables may not have been created');
      console.log('   Found:', tablesCheck.rows.map(r => r.table_name).join(', ') || 'none');
      console.log('');
    }
    
  } catch (error) {
    console.error('❌ Error executing migration:', error.message);
    console.error('\n💡 The migration may have partially applied.');
    console.error('   Check Supabase SQL Editor for details.\n');
    throw error;
  } finally {
    await client.end();
  }
}

applyMigration()
  .then(() => {
    console.log('🎉 Migration complete!');
    // Delete this script after successful migration
    const scriptPath = __filename;
    try {
      fs.unlinkSync(scriptPath);
      console.log('🧹 Cleaned up temporary script\n');
    } catch (err) {
      console.log('⚠️  Could not delete script:', err.message);
      console.log('   Please manually delete:', scriptPath, '\n');
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration failed:', error.message);
    console.error('\n💡 Script will remain for troubleshooting.');
    console.error('   Delete manually: ' + __filename + '\n');
    process.exit(1);
  });
