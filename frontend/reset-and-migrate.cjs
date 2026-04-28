#!/usr/bin/env node

/**
 * Reset partial migration artifacts and apply clean migration
 */

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: ".env.local" });

const { requireProjectRef } = require("./supabase-env.cjs");
const PROJECT_REF = requireProjectRef();

const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;

console.log("🔄 Reset and Apply Migration\n");
console.log("═".repeat(60));
console.log("");

const config = {
  host: `aws-0-us-west-2.pooler.supabase.com`,
  port: 5432,
  database: "postgres",
  user: `postgres.${PROJECT_REF}`,
  password: DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
};

async function resetAndMigrate() {
  const client = new Client(config);

  try {
    await client.connect();
    console.log("✅ Connected to database\n");

    // Step 1: Check and clean up partial migration artifacts
    console.log("🧹 Step 1: Cleaning up partial migration artifacts...\n");

    // Get all indexes that start with idx_
    const indexesResult = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname LIKE 'idx_%'
    `);

    if (indexesResult.rows.length > 0) {
      console.log(`   Found ${indexesResult.rows.length} indexes to drop\n`);

      for (const row of indexesResult.rows) {
        try {
          await client.query(`DROP INDEX IF EXISTS ${row.indexname} CASCADE`);
          process.stdout.write(".");
        } catch (e) {
          // Ignore errors
        }
      }
      console.log("\n");
    }

    // Drop cleanup function if exists
    await client.query(
      "DROP FUNCTION IF EXISTS cleanup_expired_sessions CASCADE",
    );

    console.log("✅ Cleanup complete\n");

    // Step 2: Read and apply migration
    console.log("📄 Step 2: Applying migration...\n");

    const migrationPath = path.join(
      __dirname,
      "supabase/migrations/20260109110000_complete_migration_with_demo_user.sql",
    );
    const migrationSQL = fs.readFileSync(migrationPath, "utf8");

    console.log(`   Migration file: ${path.basename(migrationPath)}`);
    console.log(`   Size: ${migrationSQL.length} characters\n`);

    console.log("⏳ Executing migration (this will take 15-30 seconds)...\n");

    await client.query(migrationSQL);

    console.log("✅ Migration applied successfully!\n");

    // Wait a moment for everything to settle
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Step 3: Verify
    console.log("🔍 Step 3: Verifying migration...\n");

    // Check schema
    const columnsResult = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'users' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);

    const hasFirstName = columnsResult.rows.some(
      (r) => r.column_name === "first_name",
    );
    const hasStudent = columnsResult.rows.some(
      (r) => r.column_name === "student",
    );

    if (hasFirstName && hasStudent) {
      console.log("✅ New schema confirmed!");
      console.log("   - first_name column: ✓");
      console.log("   - student column: ✓\n");
    } else {
      console.log("⚠️  Schema verification failed\n");
      console.log("Current columns:");
      columnsResult.rows.forEach((r) => {
        console.log(`   - ${r.column_name} (${r.data_type})`);
      });
      console.log("");
    }

    // Check users
    const userCount = await client.query("SELECT COUNT(*) as count FROM users");
    console.log(`👥 Total users: ${userCount.rows[0].count}\n`);

    // Check demo user
    try {
      const demoResult = await client.query(`
        SELECT email, first_name, student, school, last_login_at, onboarding_completed_at
        FROM users
        WHERE email = 'kare6625@colorado.edu'
      `);

      if (demoResult.rows.length > 0) {
        const demo = demoResult.rows[0];
        console.log("═".repeat(60));
        console.log("✅ Demo User Details:");
        console.log("═".repeat(60));
        console.log(`   Email: ${demo.email}`);
        console.log(`   First Name: ${demo.first_name || "Not set"}`);
        console.log(`   Student: ${demo.student || "Not set"}`);
        console.log(`   School: ${demo.school || "Not set"}`);
        console.log(`   Last Login: ${demo.last_login_at || "Not set"}`);
        console.log(
          `   Onboarding: ${demo.onboarding_completed_at ? "Complete ✓" : "Pending"}`,
        );
        console.log("");
      } else {
        console.log("⚠️  Demo user not found after migration\n");
      }
    } catch (e) {
      console.log("⚠️  Could not query demo user:", e.message, "\n");
    }

    // Check for backup tables
    const oldTables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE '%_old'
      ORDER BY table_name
    `);

    if (oldTables.rows.length > 0) {
      console.log("📦 Backup tables created:");
      oldTables.rows.forEach((t) => {
        console.log(`   - ${t.table_name}`);
      });
      console.log("");
    }

    // Check foreign keys
    const fks = await client.query(`
      SELECT
        tc.table_name,
        string_agg(kcu.column_name, ', ') as columns
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name IN ('sessions', 'courses', 'assignments')
      GROUP BY tc.table_name
      ORDER BY tc.table_name
    `);

    if (fks.rows.length > 0) {
      console.log("✅ Foreign key constraints:");
      fks.rows.forEach((fk) => {
        console.log(`   - ${fk.table_name}: ${fk.columns}`);
      });
      console.log("");
    }

    console.log("═".repeat(60));
    console.log("🎉 Migration Complete!");
    console.log("═".repeat(60));
    console.log("");
    console.log("✅ Database successfully migrated to simplified schema!");
    console.log("");
    console.log("Next steps:");
    console.log("  1. Restart frontend dev server: cd frontend && npm run dev");
    console.log("  2. Test login: kare6625@colorado.edu");
    console.log('  3. Verify header shows: "Hi, kare6625"');
    console.log("  4. Check data loads correctly");
    console.log("  5. After testing, cleanup: DROP TABLE users_old CASCADE;");
    console.log("");
  } catch (error) {
    console.error("❌ Error:", error.message);
    if (error.stack) {
      console.error("\nStack trace:", error.stack);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

resetAndMigrate();
