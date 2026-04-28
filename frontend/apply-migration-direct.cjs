#!/usr/bin/env node

/**
 * Apply migration using direct database connection (port 5432)
 */

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: ".env.local" });

const { requireProjectRef } = require("./supabase-env.cjs");
const PROJECT_REF = requireProjectRef();

const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;

if (!DB_PASSWORD) {
  console.error("❌ SUPABASE_DB_PASSWORD not found in .env.local");
  process.exit(1);
}

console.log("🚀 Applying migration via direct connection...\n");

// Read migration
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

async function tryConnection(config, label) {
  console.log(`\n🔗 Trying ${label}:`);
  console.log(`   Host: ${config.host}:${config.port}`);
  console.log(`   User: ${config.user}`);
  console.log(`   SSL: ${config.ssl ? "enabled" : "disabled"}\n`);

  const client = new Client(config);

  try {
    console.log("⏳ Connecting...");
    await client.connect();
    console.log("✅ Connected!\n");

    console.log("📊 Executing migration...");
    console.log("   (this may take 10-30 seconds)\n");

    await client.query(migrationSQL);

    console.log("✅ Migration executed!\n");

    // Verify
    console.log("🔍 Verifying...\n");

    const countResult = await client.query(
      "SELECT COUNT(*) as count FROM users",
    );
    console.log(`✅ Users table exists! Count: ${countResult.rows[0].count}\n`);

    // Sample users
    const usersResult = await client.query(
      "SELECT email, first_name, student, school FROM users ORDER BY created_at DESC LIMIT 3",
    );

    if (usersResult.rows.length > 0) {
      console.log("Recent users:");
      usersResult.rows.forEach((u) => {
        console.log(`   - ${u.email} (${u.student}) - ${u.first_name}`);
      });
      console.log("");
    }

    // Check demo user
    const demoResult = await client.query(
      `SELECT email, first_name, student, school, last_login_at, onboarding_completed_at
       FROM users WHERE email = $1`,
      ["kare6625@colorado.edu"],
    );

    if (demoResult.rows.length > 0) {
      const demo = demoResult.rows[0];
      console.log("✅ Demo user found:");
      console.log(`   Email: ${demo.email}`);
      console.log(`   Name: ${demo.first_name}`);
      console.log(`   Student: ${demo.student}`);
      console.log(`   School: ${demo.school}`);
      console.log(`   Last Login: ${demo.last_login_at || "Not set"}`);
      console.log(
        `   Onboarding: ${demo.onboarding_completed_at ? "Complete ✓" : "Pending"}\n`,
      );
    } else {
      console.log("ℹ️  Demo user not found\n");
    }

    console.log("═".repeat(60));
    console.log("🎉 Migration Complete!");
    console.log("═".repeat(60));
    console.log("");
    console.log("✅ Next steps:");
    console.log("  1. Test login with kare6625@colorado.edu");
    console.log('  2. Verify dashboard shows "Hi, kare6625"');
    console.log("  3. Check data loads correctly");
    console.log("");

    return true;
  } catch (error) {
    console.error(`❌ Failed: ${error.message}\n`);
    return false;
  } finally {
    await client.end();
  }
}

async function main() {
  // Try multiple connection configurations
  const configs = [
    {
      label: "Direct connection (IPv4)",
      host: `db.${PROJECT_REF}.supabase.co`,
      port: 5432,
      database: "postgres",
      user: "postgres",
      password: DB_PASSWORD,
      ssl: { rejectUnauthorized: false },
    },
    {
      label: "Direct connection with full user",
      host: `db.${PROJECT_REF}.supabase.co`,
      port: 5432,
      database: "postgres",
      user: `postgres.${PROJECT_REF}`,
      password: DB_PASSWORD,
      ssl: { rejectUnauthorized: false },
    },
    {
      label: "Pooler connection (session mode)",
      host: `aws-0-us-west-2.pooler.supabase.com`,
      port: 5432,
      database: "postgres",
      user: `postgres.${PROJECT_REF}`,
      password: DB_PASSWORD,
      ssl: { rejectUnauthorized: false },
    },
    {
      label: "Pooler connection (transaction mode)",
      host: `aws-0-us-west-2.pooler.supabase.com`,
      port: 6543,
      database: "postgres",
      user: `postgres.${PROJECT_REF}`,
      password: DB_PASSWORD,
      ssl: { rejectUnauthorized: false },
    },
  ];

  for (const config of configs) {
    const success = await tryConnection(config, config.label);
    if (success) {
      return;
    }
  }

  console.error("\n❌ All connection attempts failed.");
  console.error("\n🔐 Please verify:");
  console.error(`  1. Password is correct: ${DB_PASSWORD.substring(0, 3)}***`);
  console.error(
    `  2. Go to: https://supabase.com/dashboard/project/${PROJECT_REF}/settings/database`,
  );
  console.error('  3. Check "Database password" section');
  console.error("  4. If needed, reset and update .env.local\n");

  process.exit(1);
}

main();
