#!/usr/bin/env node

/**
 * Interactive migration applier - prompts for database password
 */

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { requireProjectRef } = require("./supabase-env.cjs");

const PROJECT_REF = requireProjectRef();

console.log("╔═══════════════════════════════════════════════════════════╗");
console.log("║   Supabase Migration Applier - Interactive Mode          ║");
console.log("╚═══════════════════════════════════════════════════════════╝");
console.log("");

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
console.log(`📄 Migration: ${path.basename(migrationPath)}`);
console.log(`📏 Size: ${migrationSQL.length} characters\n`);

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function getPassword() {
  console.log("🔐 Database Password Required");
  console.log("─".repeat(60));
  console.log("");
  console.log("Get your database password from:");
  console.log(
    `https://supabase.com/dashboard/project/${PROJECT_REF}/settings/database`,
  );
  console.log("");
  console.log('Look for "Database password" section.');
  console.log(
    'If hidden, click "Reset database password" and copy the new one.',
  );
  console.log("");

  const password = await question("Enter database password: ");
  console.log("");

  return password.trim();
}

async function applyMigration(password) {
  const config = {
    host: `aws-0-us-west-2.pooler.supabase.com`,
    port: 6543,
    database: "postgres",
    user: `postgres.${PROJECT_REF}`,
    password: password,
    ssl: {
      rejectUnauthorized: false,
    },
    connectionTimeoutMillis: 10000,
  };

  const client = new Client(config);

  try {
    console.log("⏳ Connecting to database...");
    console.log(`   Host: ${config.host}:${config.port}`);
    console.log(`   User: ${config.user}\n`);

    await client.connect();
    console.log("✅ Connected successfully!\n");

    console.log("📊 Executing migration...");
    console.log("   (this may take 10-30 seconds)\n");

    await client.query(migrationSQL);

    console.log("✅ Migration executed!\n");

    // Verify
    console.log("🔍 Verifying...\n");

    const usersResult = await client.query(
      "SELECT COUNT(*) as count FROM users",
    );
    console.log(`✅ Users table exists! Count: ${usersResult.rows[0].count}\n`);

    // Check demo user
    const demoResult = await client.query(
      `SELECT email, first_name, student, school, last_login_at
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
      console.log(`   Last Login: ${demo.last_login_at || "Not set"}\n`);
    } else {
      console.log("ℹ️  Demo user not found (will be created on first login)\n");
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

    // Offer to save password
    const save = await question("Save password to .env.local? (y/n): ");
    if (save.toLowerCase() === "y") {
      const envPath = path.join(__dirname, ".env.local");
      const envContent = fs.readFileSync(envPath, "utf8");

      if (envContent.includes("SUPABASE_DB_PASSWORD=")) {
        // Update existing
        const updated = envContent.replace(
          /SUPABASE_DB_PASSWORD=.*/,
          `SUPABASE_DB_PASSWORD="${password}"`,
        );
        fs.writeFileSync(envPath, updated);
      } else {
        // Append new
        fs.appendFileSync(envPath, `\nSUPABASE_DB_PASSWORD="${password}"\n`);
      }
      console.log("✅ Password saved to .env.local\n");
    }
  } catch (error) {
    console.error("❌ Error:", error.message);

    if (error.message.includes("password authentication failed")) {
      console.error("\n🔐 Authentication failed - password incorrect.");
      console.error("Please check the password and try again.\n");
    } else if (
      error.message.includes("timeout") ||
      error.message.includes("connect")
    ) {
      console.error("\n🌐 Connection failed - check network/firewall.\n");
    }

    process.exit(1);
  } finally {
    await client.end();
    rl.close();
  }
}

async function main() {
  try {
    const password = await getPassword();

    if (!password) {
      console.error("❌ No password provided");
      rl.close();
      process.exit(1);
    }

    await applyMigration(password);
  } catch (error) {
    console.error("❌ Fatal error:", error.message);
    rl.close();
    process.exit(1);
  }
}

main();
