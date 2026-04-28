#!/usr/bin/env node

/**
 * Apply Supabase migration using SQL over HTTPS
 * This uses the Supabase connection pooler REST endpoint
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

// Load environment variables
require("dotenv").config({ path: ".env.local" });

const { requireProjectRef } = require("./supabase-env.cjs");
const PROJECT_REF = requireProjectRef();

const SUPABASE_DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;

if (!SUPABASE_DB_PASSWORD) {
  console.error("❌ SUPABASE_DB_PASSWORD not found in .env.local");
  process.exit(1);
}

// Read the migration file
const migrationPath = path.join(
  __dirname,
  "supabase/migrations/20260109110000_complete_migration_with_demo_user.sql",
);

if (!fs.existsSync(migrationPath)) {
  console.error("❌ Migration file not found:", migrationPath);
  process.exit(1);
}

console.log("🚀 Starting migration application...\n");
console.log("📄 Reading migration file:", migrationPath);

const migrationSQL = fs.readFileSync(migrationPath, "utf8");

console.log(`📏 Migration size: ${migrationSQL.length} characters\n`);

// Use the PostgreSQL wire protocol over HTTP (Supabase Data API)
// We'll use curl to execute the SQL directly
const { execSync } = require("child_process");

try {
  console.log("⏳ Applying migration using pg connection...\n");

  // Create a temporary SQL file
  const tempFile = path.join(__dirname, "temp-migration.sql");
  fs.writeFileSync(tempFile, migrationSQL);

  // Build the connection string with URL encoding
  const dbUser = `postgres.${PROJECT_REF}`;
  const dbHost = "aws-0-us-west-2.pooler.supabase.com";
  const dbPort = "5432";
  const dbName = "postgres";
  const encodedPassword = encodeURIComponent(SUPABASE_DB_PASSWORD);

  // Try using Node.js pg library
  const { Pool } = require("pg");

  const pool = new Pool({
    host: dbHost,
    port: parseInt(dbPort),
    user: dbUser,
    password: SUPABASE_DB_PASSWORD,
    database: dbName,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  console.log("🔗 Connecting to database...");
  console.log(`   Host: ${dbHost}`);
  console.log(`   User: ${dbUser}\n`);

  async function runMigration() {
    const client = await pool.connect();

    try {
      console.log("✅ Connected successfully!\n");
      console.log("📊 Executing migration SQL...\n");

      // Execute the migration
      await client.query(migrationSQL);

      console.log("✅ Migration executed successfully!\n");

      // Verify the migration
      console.log("🔍 Verifying migration...\n");

      const usersResult = await client.query(
        "SELECT email, first_name, student, school FROM users LIMIT 5",
      );

      console.log(
        `✅ Users table verified! Found ${usersResult.rows.length} users\n`,
      );

      if (usersResult.rows.length > 0) {
        console.log("Sample users:");
        usersResult.rows.forEach((u) => {
          console.log(`   - ${u.email} (${u.student}) - ${u.first_name}`);
        });
        console.log("");
      }

      // Check for demo user
      console.log("🔍 Checking for demo user (kare6625@colorado.edu)...\n");

      const demoResult = await client.query(
        `SELECT email, first_name, student, school, last_login_at, onboarding_completed_at
         FROM users WHERE email = 'kare6625@colorado.edu'`,
      );

      if (demoResult.rows.length === 0) {
        console.log("⚠️  Demo user not found.\n");
      } else {
        const demo = demoResult.rows[0];
        console.log("✅ Demo user found!");
        console.log("   Email:", demo.email);
        console.log("   First Name:", demo.first_name);
        console.log("   Student:", demo.student);
        console.log("   School:", demo.school);
        console.log("   Last Login:", demo.last_login_at);
        console.log("   Onboarding Completed:", demo.onboarding_completed_at);
        console.log("");
      }

      console.log("🎉 Migration complete!\n");
      console.log("Next steps:");
      console.log("  1. Test login with kare6625@colorado.edu");
      console.log('  2. Verify dashboard shows "Hi, kare6625"');
      console.log("  3. Check that data loads correctly\n");
    } catch (error) {
      console.error("❌ Migration failed:", error.message);

      // Check if error is about existing tables (might be partially applied)
      if (error.message.includes("already exists")) {
        console.log(
          "\n⚠️  Some tables already exist. This might be okay if migration was partially applied.",
        );
        console.log("   Checking if tables exist...\n");

        try {
          const checkResult = await client.query(
            `SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'users'`,
          );

          if (checkResult.rows.length > 0) {
            console.log("✅ Users table exists. Verifying data...\n");

            const usersResult = await client.query(
              "SELECT email, first_name, student FROM users LIMIT 3",
            );

            console.log(`Found ${usersResult.rows.length} users:`);
            usersResult.rows.forEach((u) => {
              console.log(`   - ${u.email} (${u.student})`);
            });
            console.log("\n✅ Migration appears to be complete!");
          }
        } catch (verifyError) {
          console.error("Could not verify:", verifyError.message);
        }
      } else {
        throw error;
      }
    } finally {
      client.release();
      await pool.end();
    }
  }

  runMigration().catch((err) => {
    console.error("\n❌ Fatal error:", err.message);
    if (err.stack) {
      console.error("\nStack trace:", err.stack);
    }
    process.exit(1);
  });
} catch (error) {
  console.error("❌ Error:", error.message);
  process.exit(1);
}
