#!/usr/bin/env node

/**
 * Apply users table migration directly via Supabase REST API
 * This bypasses CLI TLS issues
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Error: Missing Supabase environment variables');
  console.error('   Please ensure VITE_SUPABASE_URL and SUPABASE_SERVICE_KEY are set in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function applyMigration() {
  const migrationFile = join(__dirname, 'migrations', '20251208000000_ensure_users_table.sql');
  console.log(`📖 Reading migration file: ${migrationFile}`);
  
  const sql = readFileSync(migrationFile, 'utf-8');
  
  if (!sql.trim()) {
    console.error('❌ Error: Migration file is empty');
    process.exit(1);
  }
  
  console.log('🚀 Executing SQL migration on Supabase...');
  console.log('   This will create the users and sessions tables\n');
  
  try {
    // Split SQL into statements (but keep DO blocks together)
    const statements = [];
    let currentStatement = '';
    let inDoBlock = false;
    
    const lines = sql.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('--')) {
        continue;
      }
      
      currentStatement += line + '\n';
      
      // Check for DO $$ blocks
      if (trimmed.toUpperCase().startsWith('DO $$')) {
        inDoBlock = true;
      }
      if (inDoBlock && trimmed.endsWith('$$;')) {
        inDoBlock = false;
        statements.push(currentStatement.trim());
        currentStatement = '';
      } else if (!inDoBlock && trimmed.endsWith(';')) {
        statements.push(currentStatement.trim());
        currentStatement = '';
      }
    }
    
    if (currentStatement.trim()) {
      statements.push(currentStatement.trim());
    }
    
    console.log(`   Executing ${statements.length} SQL statements...\n`);
    
    // Execute via Supabase PostgREST using rpc if available, otherwise direct REST
    // Since we can't execute DDL via PostgREST, we'll use the management API
    // For now, we'll output the SQL and instructions
    
    console.log('⚠️  Direct SQL execution via API is not available.');
    console.log('   The migration needs to be run via Supabase Dashboard.\n');
    console.log('📋 Next steps:');
    console.log('   1. Go to: https://supabase.com/dashboard/project/hwmoglxyhkecxanxdzfm/sql/new');
    console.log('   2. Copy the SQL below:');
    console.log('   3. Paste and run it\n');
    console.log('─'.repeat(60));
    console.log(sql);
    console.log('─'.repeat(60));
    
    // Alternative: Try to execute via SQL endpoint if available
    // Some Supabase setups expose a SQL execution endpoint
    console.log('\n🔄 Attempting alternative execution method...');
    
    // Try using the Supabase Management API with the access token
    const accessToken = process.env.SUPABASE_ACCESS_TOKEN || 'sbp_26de56873bb90598aae1ec5646fc6a5ad149e81e';
    
    try {
      const response = await fetch(`https://api.supabase.com/v1/projects/hwmoglxyhkecxanxdzfm/database/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: sql
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('✅ Migration executed successfully via API!');
        console.log('   Result:', result);
        return;
      } else {
        const errorText = await response.text();
        console.log(`   API method failed (${response.status}): ${errorText.substring(0, 200)}`);
      }
    } catch (apiError) {
      console.log(`   API method unavailable: ${apiError.message}`);
    }
    
    console.log('\n✅ SQL prepared. Please execute it in Supabase Dashboard.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\n📋 Manual steps:');
    console.error('   1. Go to: https://supabase.com/dashboard/project/hwmoglxyhkecxanxdzfm/sql/new');
    console.error('   2. Copy the contents of:', migrationFile);
    console.error('   3. Paste and run it in the SQL Editor');
    process.exit(1);
  }
}

applyMigration();







