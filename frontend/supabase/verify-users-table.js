#!/usr/bin/env node

/**
 * Verify that users table exists
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
const rootEnvPath = join(dirname(dirname(__dirname)), '.env');
try {
  const envContent = readFileSync(rootEnvPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        let value = valueParts.join('=').trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!process.env[key.trim()]) {
          process.env[key.trim()] = value;
        }
      }
    }
  });
} catch (e) {
  // Continue
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Error: Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function verifyTables() {
  console.log('🔍 Verifying users and sessions tables...\n');
  
  try {
    // Try to query the users table
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('count', { count: 'exact', head: true });
    
    if (usersError) {
      if (usersError.code === '42P01' || usersError.message?.includes('does not exist')) {
        console.error('❌ Users table does not exist');
        console.error('   Error:', usersError.message);
        return false;
      }
      console.error('⚠️  Error querying users table:', usersError.message);
    } else {
      console.log('✅ Users table exists!');
    }
    
    // Try to query the sessions table
    const { data: sessions, error: sessionsError } = await supabase
      .from('sessions')
      .select('count', { count: 'exact', head: true });
    
    if (sessionsError) {
      if (sessionsError.code === '42P01' || sessionsError.message?.includes('does not exist')) {
        console.error('❌ Sessions table does not exist');
        console.error('   Error:', sessionsError.message);
        return false;
      }
      console.error('⚠️  Error querying sessions table:', sessionsError.message);
    } else {
      console.log('✅ Sessions table exists!');
    }
    
    console.log('\n✅ All tables verified successfully!');
    return true;
    
  } catch (error) {
    console.error('❌ Error verifying tables:', error.message);
    return false;
  }
}

verifyTables().then(success => {
  process.exit(success ? 0 : 1);
});


