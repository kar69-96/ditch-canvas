#!/usr/bin/env node

/**
 * Check current database state
 */

const { Client } = require("pg");
const { requireProjectRef } = require("./supabase-env.cjs");
const PROJECT_REF = requireProjectRef();

const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;

const config = {
  host: `aws-0-us-west-2.pooler.supabase.com`,
  port: 5432,
  database: "postgres",
  user: `postgres.${PROJECT_REF}`,
  password: DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
};

async function checkState() {
  const client = new Client(config);

  try {
    await client.connect();
    console.log("🔍 Checking database state...\n");

    // Check users table columns
    const columnsResult = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'users' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);

    console.log("📋 Users table columns:");
    columnsResult.rows.forEach((col) => {
      console.log(`   - ${col.column_name} (${col.data_type})`);
    });
    console.log("");

    // Check for old tables
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name LIKE '%_old'
      ORDER BY table_name
    `);

    if (tablesResult.rows.length > 0) {
      console.log("📦 Old backup tables found:");
      tablesResult.rows.forEach((t) => {
        console.log(`   - ${t.table_name}`);
      });
      console.log("");
    } else {
      console.log("ℹ️  No backup tables (_old) found\n");
    }

    // Check user count and sample
    const userCountResult = await client.query(
      "SELECT COUNT(*) as count FROM users",
    );
    console.log(`👥 Total users: ${userCountResult.rows[0].count}\n`);

    // Try to get user data with old schema
    try {
      const usersResult = await client.query(
        "SELECT id, email, name FROM users LIMIT 3",
      );
      console.log('✅ Old schema detected (has "name" column):');
      usersResult.rows.forEach((u) => {
        console.log(`   - ${u.email} (${u.name})`);
      });
      console.log("\n💡 Migration needs to run to update schema.\n");
    } catch (e) {
      // Try new schema
      try {
        const usersResult = await client.query(
          "SELECT id, email, first_name, student FROM users LIMIT 3",
        );
        console.log(
          '✅ New schema detected (has "first_name" and "student" columns):',
        );
        usersResult.rows.forEach((u) => {
          console.log(`   - ${u.email} (${u.first_name}, ${u.student})`);
        });
        console.log("\n✅ Migration appears complete!\n");
      } catch (e2) {
        console.log("⚠️  Schema state unclear:", e2.message, "\n");
      }
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await client.end();
  }
}

checkState();
