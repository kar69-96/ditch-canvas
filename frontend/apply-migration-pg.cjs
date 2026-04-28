#!/usr/bin/env node

/**
 * Apply migration using node-postgres directly
 * Uses transaction pooler with proper SSL configuration
 */

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: ".env.local" });

const { requireProjectRef } = require("./supabase-env.cjs");
const PROJECT_REF = requireProjectRef();

// Read credentials
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;

if (!DB_PASSWORD) {
  console.error("❌ SUPABASE_DB_PASSWORD not found in .env.local");
  console.error("\nPlease get the database password from:");
  console.error(
    `https://supabase.com/dashboard/project/${PROJECT_REF}/settings/database`,
  );
  console.error(
    '\nThen update .env.local with: SUPABASE_DB_PASSWORD="your-password"',
  );
  process.exit(1);
}

console.log("🚀 Applying migration via PostgreSQL client...\n");

// Read migration file
const migrationPath = path.join(
  __dirname,
  "supabase/migrations/20260109110000_complete_migration_with_demo_user.sql",
);

if (!fs.existsSync(migrationPath)) {
  console.error("❌ Migration file not found:", migrationPath);
  process.exit(1);
}

const migrationSQL = fs.readFileSync(migrationPath, "utf8");
console.log(`📄 Migration file: ${path.basename(migrationPath)}`);
console.log(`📏 Size: ${migrationSQL.length} characters\n`);

// Connection configuration
// Try transaction pooler (port 6543) with proper SSL
const config = {
  host: `aws-0-us-west-2.pooler.supabase.com`,
  port: 6543,
  database: "postgres",
  user: `postgres.${PROJECT_REF}`,
  password: DB_PASSWORD,
  ssl: {
    rejectUnauthorized: false,
  },
  connectionTimeoutMillis: 10000,
};

console.log("🔗 Connection details:");
console.log(`   Host: ${config.host}:${config.port}`);
console.log(`   User: ${config.user}`);
console.log(`   Database: ${config.database}\n`);

async function applyMigration() {
  const client = new Client(config);

  try {
    console.log("⏳ Connecting to database...\n");
    await client.connect();
    console.log("✅ Connected successfully!\n");

    console.log("📊 Executing migration SQL...");
    console.log("   (this may take 10-30 seconds)\n");

    // Execute the entire migration
    const result = await client.query(migrationSQL);

    console.log("✅ Migration executed successfully!\n");

    // Verify users table
    console.log("🔍 Verifying migration...\n");

    const usersResult = await client.query(
      "SELECT email, first_name, student, school FROM users ORDER BY created_at DESC LIMIT 5",
    );

    console.log(
      `✅ Users table verified! Found ${usersResult.rows.length} users\n`,
    );

    if (usersResult.rows.length > 0) {
      console.log("Recent users:");
      usersResult.rows.forEach((u) => {
        console.log(`   - ${u.email} (${u.student}) - ${u.first_name}`);
      });
      console.log("");
    }

    // Check demo user
    console.log("🔍 Checking demo user (kare6625@colorado.edu)...\n");

    const demoResult = await client.query(
      `SELECT email, first_name, student, school, last_login_at, onboarding_completed_at
       FROM users WHERE email = $1`,
      ["kare6625@colorado.edu"],
    );

    if (demoResult.rows.length === 0) {
      console.log("⚠️  Demo user not found.");
      console.log("   This is normal if it's a fresh database.\n");
    } else {
      const demo = demoResult.rows[0];
      console.log("✅ Demo user found!");
      console.log("   Email:", demo.email);
      console.log("   First Name:", demo.first_name);
      console.log("   Student:", demo.student);
      console.log("   School:", demo.school);
      console.log("   Last Login:", demo.last_login_at || "Not set");
      console.log(
        "   Onboarding:",
        demo.onboarding_completed_at ? "Complete ✓" : "Pending",
      );
      console.log("");
    }

    // Check for old tables (backup check)
    const oldTablesResult = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name LIKE '%_old'
       ORDER BY table_name`,
    );

    if (oldTablesResult.rows.length > 0) {
      console.log("📦 Old tables backed up:");
      oldTablesResult.rows.forEach((t) => {
        console.log(`   - ${t.table_name}`);
      });
      console.log("\n💡 Old tables kept as backup. Drop after testing with:");
      console.log("   DROP TABLE users_old CASCADE;");
      console.log("");
    }

    console.log("═".repeat(60));
    console.log("🎉 Migration complete!");
    console.log("═".repeat(60));
    console.log("");
    console.log("✅ Next steps:");
    console.log("  1. Test login with kare6625@colorado.edu");
    console.log('  2. Verify dashboard header shows "Hi, kare6625"');
    console.log("  3. Check that courses and assignments load");
    console.log("  4. After 1-2 days of testing, cleanup old tables");
    console.log("");
  } catch (error) {
    console.error("❌ Migration failed!");
    console.error("");

    if (error.message.includes("password authentication failed")) {
      console.error("🔐 Authentication Error:");
      console.error(
        "   The database password in .env.local appears to be incorrect.",
      );
      console.error("");
      console.error("To fix:");
      console.error(
        `  1. Go to: https://supabase.com/dashboard/project/${PROJECT_REF}/settings/database`,
      );
      console.error('  2. Click "Reset database password"');
      console.error("  3. Copy the new password");
      console.error(
        '  4. Update .env.local: SUPABASE_DB_PASSWORD="new-password"',
      );
      console.error("  5. Run this script again");
      console.error("");
    } else if (error.message.includes("connect")) {
      console.error("🌐 Connection Error:");
      console.error("   Could not connect to Supabase database.");
      console.error("   Error:", error.message);
      console.error("");
    } else {
      console.error("Error:", error.message);
      if (error.stack) {
        console.error("\nStack trace:");
        console.error(error.stack);
      }
    }

    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run migration
applyMigration().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
