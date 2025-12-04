#!/usr/bin/env node

/**
 * Script to sync SQL migration file with Supabase
 * This allows you to edit the SQL file locally and sync it to Supabase
 * 
 * Usage: node supabase/sync-migration.js
 * 
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables
 * or set them in .env file
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

// Load environment variables
config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  console.error('❌ Error: VITE_SUPABASE_URL or SUPABASE_URL not found in environment');
  console.error('   Please set it in your .env file');
  process.exit(1);
}

if (!supabaseServiceKey) {
  console.warn('⚠️  Warning: SUPABASE_SERVICE_ROLE_KEY not found');
  console.warn('   Using anon key instead (some operations may fail)');
  console.warn('   For full functionality, add SUPABASE_SERVICE_ROLE_KEY to .env');
}

const supabase = createClient(
  supabaseUrl,
  supabaseServiceKey || process.env.VITE_SUPABASE_ANON_KEY
);

async function syncMigration() {
  try {
    const migrationFile = join(__dirname, 'migrations', '001_create_users_and_sessions.sql');
    console.log(`📖 Reading migration file: ${migrationFile}`);
    
    const sql = readFileSync(migrationFile, 'utf-8');
    
    if (!sql.trim()) {
      console.error('❌ Error: Migration file is empty');
      process.exit(1);
    }
    
    console.log('🚀 Executing SQL migration on Supabase...');
    console.log('   This will create/update tables, indexes, and policies\n');
    
    // Execute the SQL
    const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });
    
    if (error) {
      // If exec_sql function doesn't exist, try direct query
      console.log('   Trying alternative method...');
      
      // Split SQL into individual statements
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));
      
      let successCount = 0;
      let errorCount = 0;
      
      for (const statement of statements) {
        try {
          // Use Supabase REST API directly for DDL operations
          const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': supabaseServiceKey || process.env.VITE_SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${supabaseServiceKey || process.env.VITE_SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({ sql_query: statement }),
          });
          
          if (!response.ok) {
            // Try executing via SQL editor endpoint
            console.log(`   Executing: ${statement.substring(0, 50)}...`);
            errorCount++;
          } else {
            successCount++;
          }
        } catch (err) {
          console.warn(`   ⚠️  Could not execute statement: ${err.message}`);
          errorCount++;
        }
      }
      
      if (errorCount > 0) {
        console.log(`\n⚠️  Some statements could not be executed automatically`);
        console.log(`   Please copy the SQL from the migration file and run it in Supabase SQL Editor`);
        console.log(`   File: ${migrationFile}\n`);
      }
    } else {
      console.log('✅ Migration executed successfully!\n');
    }
    
    console.log('📋 Next steps:');
    console.log('   1. Go to your Supabase dashboard → SQL Editor');
    console.log('   2. Copy the contents of: supabase/migrations/001_create_users_and_sessions.sql');
    console.log('   3. Paste and run it in the SQL Editor');
    console.log('   4. Verify tables were created in Table Editor\n');
    
  } catch (error) {
    console.error('❌ Error syncing migration:', error.message);
    console.error('\n📋 Manual steps:');
    console.error('   1. Go to your Supabase dashboard → SQL Editor');
    console.error('   2. Copy the contents of: supabase/migrations/001_create_users_and_sessions.sql');
    console.error('   3. Paste and run it in the SQL Editor');
    process.exit(1);
  }
}

syncMigration();

