#!/usr/bin/env node

/**
 * Simple migration applier - writes instructions for manual application
 */

const fs = require("fs");
const path = require("path");

console.log("🚀 Supabase Migration Helper\n");
console.log("═".repeat(60));
console.log("");

// Read the migration file
const migrationPath = path.join(
  __dirname,
  "supabase/migrations/20260109110000_complete_migration_with_demo_user.sql",
);

if (!fs.existsSync(migrationPath)) {
  console.error("❌ Migration file not found:", migrationPath);
  process.exit(1);
}

const migrationSQL = fs.readFileSync(migrationPath, "utf8");

console.log(
  "📄 Migration file ready: 20260109110000_complete_migration_with_demo_user.sql",
);
console.log(`📏 Size: ${migrationSQL.length} characters\n`);
console.log("");

// Write to a temp file for easy copying
const outputPath = path.join(__dirname, "migration-to-apply.sql");
fs.writeFileSync(outputPath, migrationSQL);

console.log("✅ Migration SQL has been copied to: migration-to-apply.sql\n");
console.log("");
console.log("═".repeat(60));
console.log("📋 MANUAL APPLICATION STEPS");
console.log("═".repeat(60));
console.log("");
console.log("The CLI connection is having authentication issues.");
console.log("Please apply the migration manually using Supabase Dashboard:");
console.log("");
console.log("OPTION 1: Supabase Dashboard (Recommended)");
console.log("─".repeat(60));
console.log("1. Go to: https://supabase.com/dashboard");
console.log(
  "2. Select your project in the Supabase dashboard (same ID as SUPABASE_PROJECT_REF in .env.local)",
);
console.log('3. Click "SQL Editor" in the left sidebar');
console.log('4. Click "New Query"');
console.log("5. Open file: " + outputPath);
console.log("6. Copy ALL the contents");
console.log("7. Paste into the SQL Editor");
console.log('8. Click "Run" (or press Cmd+Enter)');
console.log("9. Wait for completion (5-30 seconds)");
console.log("10. Review the NOTICE messages for success confirmation");
console.log("");
console.log("OPTION 2: Copy to clipboard (macOS)");
console.log("─".repeat(60));
console.log("Run this command to copy the SQL to your clipboard:");
console.log("");
console.log(`   pbcopy < "${outputPath}"`);
console.log("");
console.log("Then paste directly into Supabase SQL Editor and click Run.");
console.log("");
console.log("═".repeat(60));
console.log("✅ AFTER APPLYING");
console.log("═".repeat(60));
console.log("");
console.log("You should see output like:");
console.log("  NOTICE: Migration Summary:");
console.log("  NOTICE:   Users: X → Y");
console.log("  NOTICE:   Demo User: kare6625@colorado.edu created/updated");
console.log("");
console.log("Then verify with these SQL queries:");
console.log("");
console.log("  -- Check demo user");
console.log("  SELECT email, first_name, student, school, last_login_at");
console.log("  FROM users");
console.log("  WHERE email = 'kare6625@colorado.edu';");
console.log("");
console.log("  -- Check all users");
console.log("  SELECT email, student, first_name FROM users LIMIT 5;");
console.log("");
console.log("═".repeat(60));
console.log("");
console.log(
  "💡 TIP: Keep the old tables as backup for 1-2 days before cleanup.",
);
console.log("");
