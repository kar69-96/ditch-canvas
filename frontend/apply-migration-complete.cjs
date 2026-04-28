#!/usr/bin/env node

/**
 * Apply migration as a single transaction
 */

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: ".env.local" });

const { requireProjectRef } = require("./supabase-env.cjs");
const PROJECT_REF = requireProjectRef();

const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;

console.log("🚀 Applying complete migration...\n");

// Read migration
const migrationPath = path.join(
  __dirname,
  "supabase/migrations/20260109110000_complete_migration_with_demo_user.sql",
);
const migrationSQL = fs.readFileSync(migrationPath, "utf8");

console.log(`📄 Migration: ${path.basename(migrationPath)}`);
console.log(`📏 Size: ${migrationSQL.length} characters\n`);

const config = {
  host: `aws-0-us-west-2.pooler.supabase.com`,
  port: 5432,
  database: "postgres",
  user: `postgres.${PROJECT_REF}`,
  password: DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
};

async function applyMigration() {
  const client = new Client(config);

  try {
    console.log("⏳ Connecting to database...\n");
    await client.connect();
    console.log("✅ Connected!\n");

    console.log("📊 Executing migration as single transaction...");
    console.log("   (this will take 15-30 seconds)\n");

    // Execute the entire migration SQL as one query
    // PostgreSQL will handle it properly, including DO blocks
    const result = await client.query(migrationSQL);

    console.log("✅ Migration executed successfully!\n");

    // Small delay to ensure all async operations complete
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify the new schema
    console.log("🔍 Verifying new schema...\n");

    const columnsResult = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'users' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);

    const columns = columnsResult.rows.map((r) => r.column_name);
    console.log("✅ Users table columns:", columns.join(", "));
    console.log("");

    // Check if new schema
    if (columns.includes("first_name") && columns.includes("student")) {
      console.log("✅ New schema confirmed!\n");
    } else {
      console.log("⚠️  Schema may not have updated properly\n");
    }

    // Count users
    const countResult = await client.query(
      "SELECT COUNT(*) as count FROM users",
    );
    console.log(`👥 Total users: ${countResult.rows[0].count}\n`);

    // Check demo user with new schema
    const demoResult = await client.query(`
      SELECT email, first_name, student, school, last_login_at, onboarding_completed_at
      FROM users
      WHERE email = 'kare6625@colorado.edu'
    `);

    if (demoResult.rows.length > 0) {
      const demo = demoResult.rows[0];
      console.log("═".repeat(60));
      console.log("✅ Demo User Verified:");
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
      console.log("⚠️  Demo user not found\n");
    }

    // Check for old backup tables
    const oldTablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE '%_old'
      ORDER BY table_name
    `);

    if (oldTablesResult.rows.length > 0) {
      console.log("📦 Backup tables created:");
      oldTablesResult.rows.forEach((t) => {
        console.log(`   - ${t.table_name}`);
      });
      console.log(
        "\n💡 Old tables kept as backup. Test thoroughly before dropping.\n",
      );
    }

    console.log("═".repeat(60));
    console.log("🎉 Migration Complete!");
    console.log("═".repeat(60));
    console.log("");
    console.log("✅ Next steps:");
    console.log("  1. Restart your frontend dev server (if running)");
    console.log("  2. Test login with: kare6625@colorado.edu");
    console.log('  3. Dashboard should show: "Hi, kare6625"');
    console.log("  4. Verify courses and assignments load");
    console.log("  5. After 1-2 days of testing, drop old tables");
    console.log("");
  } catch (error) {
    console.error("❌ Migration failed:", error.message);

    if (error.message.includes("already exists")) {
      console.log(
        "\n⚠️  Some objects already exist. Checking current state...\n",
      );

      try {
        const checkResult = await client.query(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_name = 'users' AND table_schema = 'public'
          AND column_name IN ('first_name', 'student')
        `);

        if (checkResult.rows.length >= 2) {
          console.log("✅ New schema appears to be in place already!");
          console.log("   Migration may have completed previously.\n");
        } else {
          console.log(
            "⚠️  Schema is mixed. Manual intervention may be needed.\n",
          );
        }
      } catch (e) {
        console.error("Could not check schema:", e.message);
      }
    }

    if (error.stack) {
      console.error("\nStack trace:", error.stack);
    }

    process.exit(1);
  } finally {
    await client.end();
  }
}

applyMigration();
