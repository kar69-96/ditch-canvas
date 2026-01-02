#!/usr/bin/env node
/**
 * Apply critical migrations directly to Supabase
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const SUPABASE_DB_PASSWORD = 'ie10dsWMfNxJSwI';
const projectRef = 'hwmoglxyhkecxanxdzfm';

// Try different connection formats
const connectionStrings = [
  `postgresql://postgres:${SUPABASE_DB_PASSWORD}@db.${projectRef}.supabase.co:5432/postgres`,
  `postgresql://postgres.${projectRef}:${SUPABASE_DB_PASSWORD}@db.${projectRef}.supabase.co:5432/postgres`,
];

async function applyMigrations() {
  let client;
  
  // Try to connect
  for (const connStr of connectionStrings) {
    try {
      console.log('🔌 Attempting connection...');
      client = new Client({
        connectionString: connStr,
        ssl: { rejectUnauthorized: false },
      });
      await client.connect();
      console.log('✅ Connected to database\n');
      break;
    } catch (error) {
      console.log(`❌ Connection failed: ${error.message}`);
      if (client) {
        try {
          await client.end();
        } catch (_) {}
      }
      continue;
    }
  }
  
  if (!client || client._ending) {
    console.error('❌ Failed to connect with all connection formats');
    process.exit(1);
  }

  try {
    // Read and apply assignments migration
    console.log('📝 Applying assignments table migration...\n');
    const assignmentsSQL = fs.readFileSync(
      path.join(__dirname, 'frontend', 'supabase', 'migrations', '002_create_extraction_data_tables.sql'),
      'utf8'
    );
    await client.query(assignmentsSQL);
    console.log('✅ Assignments table migration applied\n');
    
    // Read and apply integrations migration
    console.log('📝 Applying integrations table migration...\n');
    const integrationsSQL = fs.readFileSync(
      path.join(__dirname, 'frontend', 'supabase', 'migrations', '20251225000000_integrations_v3_single_target.sql'),
      'utf8'
    );
    await client.query(integrationsSQL);
    console.log('✅ Integrations table migration applied\n');
    
    // Verify tables exist
    console.log('🔍 Verifying tables...\n');
    const tablesCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('assignments', 'integrations', 'integration_item_mappings')
      ORDER BY table_name;
    `);
    
    console.log('✅ Tables found:');
    tablesCheck.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });
    
    if (tablesCheck.rows.length === 3) {
      console.log('\n🎉 All required tables created successfully!');
    } else {
      console.log(`\n⚠️  Expected 3 tables, found ${tablesCheck.rows.length}`);
    }
    
  } catch (error) {
    console.error('❌ Error applying migrations:', error.message);
    console.error('\nStack:', error.stack);
    throw error;
  } finally {
    await client.end();
  }
}

applyMigrations()
  .then(() => {
    console.log('\n✅ Migration complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  });




