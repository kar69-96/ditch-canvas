#!/usr/bin/env node
/**
 * Development script to start the frontend with a specific test user
 * Usage: node dev-as.cjs <email>
 * Example: node dev-as.cjs user@colorado.edu
 */

const { spawn } = require("child_process");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

async function main() {
  const email = process.argv[2];

  if (!email) {
    console.error("Usage: npm run dev:as <email>");
    console.error("Example: npm run dev:as user@colorado.edu");
    console.error("\nTo list available users: npm run dev:as --list");
    process.exit(1);
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("Missing Supabase credentials in .env file");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // List users mode
  if (email === "--list") {
    const { data: users, error } = await supabase
      .from("users")
      .select("id, email")
      .order("email");

    if (error) {
      console.error("Error fetching users:", error.message);
      process.exit(1);
    }

    console.log("\nAvailable users:");
    console.log("─".repeat(60));
    users.forEach((user) => {
      console.log(`  ${user.email}`);
    });
    console.log("─".repeat(60));
    console.log(`\nTotal: ${users.length} users\n`);
    process.exit(0);
  }

  // Look up user by email
  const { data: user, error } = await supabase
    .from("users")
    .select("id, email")
    .eq("email", email)
    .single();

  if (error || !user) {
    console.error(`User not found: ${email}`);
    console.error("\nRun 'npm run dev:as --list' to see available users");
    process.exit(1);
  }

  const TIMEOUT_MINUTES = 20;
  console.log(`\nStarting dev server as: ${user.email}`);
  console.log(`ID: ${user.id}`);
  console.log(`Session will auto-expire in ${TIMEOUT_MINUTES} minutes\n`);

  // Start Vite with the test user env vars
  const vite = spawn("npx", ["vite"], {
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_TEST_USER_ID: user.id,
      VITE_TEST_USER_EMAIL: user.email,
    },
  });

  // Auto-shutdown after timeout
  const timeoutId = setTimeout(
    () => {
      console.log(
        `\n\n⏰ Session expired after ${TIMEOUT_MINUTES} minutes. Shutting down...\n`,
      );
      vite.kill("SIGTERM");
    },
    TIMEOUT_MINUTES * 60 * 1000,
  );

  vite.on("error", (err) => {
    clearTimeout(timeoutId);
    console.error("Failed to start Vite:", err);
    process.exit(1);
  });

  vite.on("close", (code) => {
    clearTimeout(timeoutId);
    process.exit(code || 0);
  });
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
