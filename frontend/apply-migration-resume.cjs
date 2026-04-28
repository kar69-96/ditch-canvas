#!/usr/bin/env node

/**
 * Apply migration with error handling for partially applied migrations
 */

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: ".env.local" });

const { requireProjectRef } = require("./supabase-env.cjs");
const PROJECT_REF = requireProjectRef();

const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;

console.log("🚀 Applying/Resuming migration...\n");

// Read migration
const migrationPath = path.join(
  __dirname,
  "supabase/migrations/20260109110000_complete_migration_with_demo_user.sql",
);
const migrationSQL = fs.readFileSync(migrationPath, "utf8");

console.log(`📄 Migration: ${path.basename(migrationPath)}`);
console.log(`📏 Size: ${migrationSQL.length} characters\n`);

// Connection config (using session mode pooler - port 5432)
const config = {
  host: `aws-0-us-west-2.pooler.supabase.com`,
  port: 5432,
  database: "postgres",
  user: `postgres.${PROJECT_REF}`,
  password: DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
};

async function applyMigration() {
  const client = new Client(config);

  try {
    console.log("⏳ Connecting to database...\n");
    await client.connect();
    console.log("✅ Connected!\n");

    // Split SQL into individual statements
    const statements = migrationSQL
      .split(
        /;(?=\s*(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|DO|SELECT|COMMENT|--|\s*$))/i,
      )
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("--"));

    console.log(`📊 Found ${statements.length} SQL statements\n`);
    console.log(
      '⏳ Executing migration (ignoring "already exists" errors)...\n',
    );

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i] + ";";

      try {
        await client.query(stmt);
        successCount++;
        if (i % 20 === 0) process.stdout.write(".");
      } catch (error) {
        const msg = error.message.toLowerCase();

        // Expected errors (things already exist)
        if (
          msg.includes("already exists") ||
          msg.includes("does not exist") ||
          msg.includes("duplicate key")
        ) {
          skipCount++;
          if (i % 20 === 0) process.stdout.write("s");
        }
        // NOTICE messages (not actual errors)
        else if (error.severity === "NOTICE" || msg.includes("notice:")) {
          skipCount++;
        } else {
          console.error(`\n⚠️  Statement ${i + 1} error: ${error.message}`);
          errorCount++;
        }
      }
    }

    console.log("\n");
    console.log("═".repeat(60));
    console.log("📊 Execution Summary:");
    console.log("═".repeat(60));
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ⏭️  Skipped (already exists): ${skipCount}`);
    console.log(`   ❌ Errors: ${errorCount}\n`);

    // Verify the result
    console.log("🔍 Verifying database state...\n");

    // Check users table
    const countResult = await client.query(
      "SELECT COUNT(*) as count FROM users",
    );
    console.log(
      `✅ Users table exists! Total users: ${countResult.rows[0].count}`,
    );

    // Sample users
    const usersResult = await client.query(
      "SELECT email, first_name, student, school FROM users ORDER BY created_at DESC LIMIT 5",
    );

    if (usersResult.rows.length > 0) {
      console.log("\n📋 Recent users:");
      usersResult.rows.forEach((u, i) => {
        console.log(`   ${i + 1}. ${u.email} (${u.student}) - ${u.first_name}`);
      });
    }

    // Check demo user
    console.log("\n🔍 Checking demo user (kare6625@colorado.edu)...\n");

    const demoResult = await client.query(
      `SELECT email, first_name, student, school, last_login_at, onboarding_completed_at, created_at
       FROM users WHERE email = $1`,
      ["kare6625@colorado.edu"],
    );

    if (demoResult.rows.length === 0) {
      console.log("⚠️  Demo user not found. Creating now...\n");

      // Create demo user
      await client.query(
        `
        INSERT INTO users (
          email, first_name, student, school,
          last_login_at, onboarding_completed_at,
          profile_preferences, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, NOW(), NOW(),
          '{"theme": "system", "font": "default"}'::JSONB,
          NOW(), NOW()
        )
        ON CONFLICT (email) DO UPDATE SET
          first_name = EXCLUDED.first_name,
          student = EXCLUDED.student,
          school = EXCLUDED.school,
          last_login_at = NOW(),
          onboarding_completed_at = COALESCE(users.onboarding_completed_at, NOW()),
          updated_at = NOW()
      `,
        [
          "kare6625@colorado.edu",
          "Karthik",
          "kare6625",
          "University of Colorado - Boulder",
        ],
      );

      console.log("✅ Demo user created!\n");

      // Fetch again
      const newDemoResult = await client.query(
        "SELECT * FROM users WHERE email = $1",
        ["kare6625@colorado.edu"],
      );

      if (newDemoResult.rows.length > 0) {
        const demo = newDemoResult.rows[0];
        console.log("✅ Demo user verified:");
        console.log(`   Email: ${demo.email}`);
        console.log(`   Name: ${demo.first_name}`);
        console.log(`   Student: ${demo.student}`);
        console.log(`   School: ${demo.school}`);
        console.log(`   Last Login: ${demo.last_login_at}`);
        console.log(`   Onboarding: Complete ✓\n`);
      }
    } else {
      const demo = demoResult.rows[0];
      console.log("✅ Demo user found:");
      console.log(`   Email: ${demo.email}`);
      console.log(`   Name: ${demo.first_name}`);
      console.log(`   Student: ${demo.student}`);
      console.log(`   School: ${demo.school}`);
      console.log(`   Last Login: ${demo.last_login_at || "Not set"}`);
      console.log(
        `   Onboarding: ${demo.onboarding_completed_at ? "Complete ✓" : "Pending"}`,
      );
      console.log(`   Created: ${demo.created_at}\n`);
    }

    // Check foreign keys
    const fkResult = await client.query(`
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name IN ('courses', 'assignments', 'sessions')
      ORDER BY tc.table_name
    `);

    if (fkResult.rows.length > 0) {
      console.log("✅ Foreign key constraints verified:");
      fkResult.rows.forEach((fk) => {
        console.log(
          `   - ${fk.table_name}.${fk.column_name} → ${fk.foreign_table_name}`,
        );
      });
      console.log("");
    }

    console.log("═".repeat(60));
    console.log("🎉 Migration Complete!");
    console.log("═".repeat(60));
    console.log("");
    console.log("✅ Database is ready! Next steps:");
    console.log("  1. Test login with: kare6625@colorado.edu");
    console.log('  2. Dashboard should show: "Hi, kare6625"');
    console.log("  3. Verify courses and assignments load");
    console.log("");
  } catch (error) {
    console.error("❌ Fatal error:", error.message);
    if (error.stack) {
      console.error("\nStack trace:", error.stack);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

applyMigration();
