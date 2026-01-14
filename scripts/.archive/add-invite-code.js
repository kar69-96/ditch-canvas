/**
 * Script to add invite codes to the database
 *
 * Usage:
 *   node scripts/utils/add-invite-code.js <CODE> <MAX_USERS>
 *
 * Example:
 *   node scripts/utils/add-invite-code.js BETA2024 100
 */

require("dotenv").config({
  path: require("path").join(__dirname, "..", "..", ".env"),
});
const { createClient } = require("@supabase/supabase-js");
const { getSupabaseConfig } = require("../../src/core/config");

const supabaseConfig = getSupabaseConfig();
const supabase = createClient(supabaseConfig.url, supabaseConfig.serviceKey);

async function addInviteCode(code, maxUsers) {
  const normalizedCode = code.toUpperCase().trim();

  if (!normalizedCode) {
    console.error("❌ Error: Invite code cannot be empty");
    process.exit(1);
  }

  const maxUsersNum = parseInt(maxUsers, 10);
  if (isNaN(maxUsersNum) || maxUsersNum < 1) {
    console.error("❌ Error: Max users must be a positive number");
    process.exit(1);
  }

  try {
    // Check if code already exists
    const { data: existing, error: checkError } = await supabase
      .from("invite_codes")
      .select("code, max_users, current_users, is_active")
      .eq("code", normalizedCode)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      throw checkError;
    }

    if (existing) {
      console.log(
        `⚠️  Invite code "${normalizedCode}" already exists, updating max_users to ${maxUsersNum}...`,
      );

      const { data: updated, error: updateError } = await supabase
        .from("invite_codes")
        .update({ max_users: maxUsersNum, is_active: true })
        .eq("code", normalizedCode)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }

      console.log("✅ Invite code updated successfully!");
      console.log(`   Code: ${updated.code}`);
      console.log(`   Max users: ${updated.max_users}`);
      console.log(`   Current users: ${updated.current_users}`);
      console.log(`   Active: ${updated.is_active}`);
      process.exit(0);
    }

    // Insert new invite code
    const { data, error } = await supabase
      .from("invite_codes")
      .insert({
        code: normalizedCode,
        max_users: maxUsersNum,
        current_users: 0,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    console.log("✅ Invite code added successfully!");
    console.log(`   Code: ${data.code}`);
    console.log(`   Max users: ${data.max_users}`);
    console.log(`   Current users: ${data.current_users}`);
    console.log(`   Active: ${data.is_active}`);
  } catch (error) {
    console.error("❌ Error adding invite code:", error.message);
    process.exit(1);
  }
}

// Get command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
  console.log(
    "Usage: node scripts/utils/add-invite-code.js <CODE> <MAX_USERS>",
  );
  console.log("Example: node scripts/utils/add-invite-code.js BETA2024 100");
  process.exit(1);
}

const [code, maxUsers] = args;
addInviteCode(code, maxUsers);
