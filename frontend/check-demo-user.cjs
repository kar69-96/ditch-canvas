#!/usr/bin/env node

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

async function checkDemoUser() {
  const client = new Client(config);

  try {
    await client.connect();

    const result = await client.query(
      "SELECT email, first_name, student FROM users WHERE email = $1",
      ["kare6625@colorado.edu"],
    );

    if (result.rows.length > 0) {
      const user = result.rows[0];
      console.log("Demo user data:");
      console.log(`  Email: ${user.email}`);
      console.log(`  First Name: ${user.first_name}`);
      console.log(`  Student: ${user.student}`);
      console.log("");

      if (user.first_name === "kare6625" || user.first_name === user.student) {
        console.log(
          "⚠️  First name is set to student identikey. Let me update it...\n",
        );

        await client.query(
          `UPDATE users SET first_name = $1, updated_at = NOW() WHERE email = $2`,
          ["Karthik", "kare6625@colorado.edu"],
        );

        console.log('✅ Updated first_name to "Karthik"\n');

        const updated = await client.query(
          "SELECT email, first_name, student FROM users WHERE email = $1",
          ["kare6625@colorado.edu"],
        );

        console.log("Updated demo user:");
        console.log(`  Email: ${updated.rows[0].email}`);
        console.log(`  First Name: ${updated.rows[0].first_name}`);
        console.log(`  Student: ${updated.rows[0].student}`);
      } else {
        console.log("✅ First name is already set correctly");
      }
    } else {
      console.log("❌ Demo user not found");
    }
  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    await client.end();
  }
}

checkDemoUser();
