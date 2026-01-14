const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const { getSupabaseConfig } = require("../core/config");
const { getCookieFilename } = require("../utils/cookie-helpers");
const fs = require("fs");

const router = express.Router();

// Initialize Supabase client
const supabaseConfig = getSupabaseConfig();
const supabase = createClient(supabaseConfig.url, supabaseConfig.serviceKey);

// Helper function to convert email to numeric ID (matching userDatabase logic)
function emailToNumericId(email) {
  let hash = 0;
  const normalizedEmail = email.toLowerCase().trim();
  for (let i = 0; i < normalizedEmail.length; i++) {
    const char = normalizedEmail.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash) % 2147483647; // Ensure positive and within INTEGER range
}

/**
 * POST /api/onboarding/personal-info
 * Validate school and store personal info temporarily
 */
router.post("/personal-info", async (req, res) => {
  try {
    const { firstName, school, email } = req.body;

    if (!firstName || !school || !email) {
      return res.status(400).json({
        success: false,
        error: "First name, school, and email are required",
      });
    }

    // Validate email format
    const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: "Invalid email format",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Validate school - must be "University of Colorado - Boulder" to proceed
    const validSchool = "University of Colorado - Boulder";
    if (school !== validSchool) {
      // School is invalid - will be added to waitlist
      return res.json({
        success: false,
        validSchool: false,
        message: "Only University of Colorado students can proceed",
      });
    }

    // Check if user already exists
    const { data: existingUser, error: checkError } = await supabase
      .from("users")
      .select("id, email")
      .eq("email", normalizedEmail)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      // PGRST116 = not found
      console.error("[onboarding] Error checking existing user:", checkError);
      return res.status(500).json({
        success: false,
        error: "Error checking existing user",
      });
    }

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: "User with this email already exists",
      });
    }

    // Valid school - return success (data will be stored in frontend state/sessionStorage)
    return res.json({
      success: true,
      validSchool: true,
      data: {
        firstName,
        school,
        email: normalizedEmail,
      },
    });
  } catch (error) {
    console.error("[onboarding] Error in personal-info:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * POST /api/onboarding/validate-invite
 * Validate invite code
 */
router.post("/validate-invite", async (req, res) => {
  try {
    const { inviteCode } = req.body;

    if (!inviteCode) {
      return res.status(400).json({
        success: false,
        error: "Invite code is required",
      });
    }

    const normalizedCode = inviteCode.toUpperCase().trim();

    // Check invite code in database
    const { data: inviteCodeData, error } = await supabase
      .from("invite_codes")
      .select("*")
      .eq("code", normalizedCode)
      .single();

    if (error || !inviteCodeData) {
      return res.json({
        success: false,
        valid: false,
        error: "Invalid invite code",
      });
    }

    // Check if code is active
    if (!inviteCodeData.is_active) {
      return res.json({
        success: false,
        valid: false,
        error: "Invite code is no longer active",
      });
    }

    // Check if code has reached max users
    if (inviteCodeData.current_users >= inviteCodeData.max_users) {
      return res.json({
        success: false,
        valid: false,
        error: "Invite code has reached maximum users",
      });
    }

    // Valid invite code
    return res.json({
      success: true,
      valid: true,
      data: {
        code: normalizedCode,
        maxUsers: inviteCodeData.max_users,
        currentUsers: inviteCodeData.current_users,
      },
    });
  } catch (error) {
    console.error("[onboarding] Error in validate-invite:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * POST /api/onboarding/waitlist
 * Add user to waitlist table
 */
router.post("/waitlist", async (req, res) => {
  try {
    const { firstName, school, email } = req.body;

    if (!firstName || !school || !email) {
      return res.status(400).json({
        success: false,
        error: "First name, school, and email are required",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if email already exists in waitlist
    const { data: existingWaitlist, error: checkError } = await supabase
      .from("waitlist")
      .select("id")
      .eq("email", normalizedEmail)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      console.error(
        "[onboarding] Error checking existing waitlist entry:",
        checkError,
      );
      return res.status(500).json({
        success: false,
        error: "Error checking waitlist",
      });
    }

    if (existingWaitlist) {
      // Already in waitlist
      return res.json({
        success: true,
        message: "You are already on the waitlist",
        alreadyExists: true,
      });
    }

    // Insert into waitlist table
    const { data, error } = await supabase
      .from("waitlist")
      .insert({
        first_name: firstName,
        school: school,
        email: normalizedEmail,
      })
      .select()
      .single();

    if (error) {
      console.error("[onboarding] Error adding to waitlist:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to add to waitlist",
      });
    }

    return res.json({
      success: true,
      message: "Successfully added to waitlist",
      data,
    });
  } catch (error) {
    console.error("[onboarding] Error in waitlist:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * POST /api/onboarding/sync
 * Save identikey and prepare for cookie extraction
 */
router.post("/sync", async (req, res) => {
  try {
    const { identikey, email, firstName, school, inviteCode } = req.body;

    if (!identikey || !email) {
      return res.status(400).json({
        success: false,
        error: "Identikey and email are required",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedIdentikey = identikey.trim();

    // Validate that we have all required onboarding data
    if (!firstName || !school || !inviteCode) {
      return res.status(400).json({
        success: false,
        error: "Missing onboarding data. Please start over.",
      });
    }

    // Store temporarily (will be used when creating user after cookie extraction)
    // In a real implementation, you might want to store this in Redis or a temporary table
    // For now, we'll rely on the frontend to send it again in the complete endpoint

    return res.json({
      success: true,
      message: "Identikey saved. Proceed with cookie extraction.",
      data: {
        identikey: normalizedIdentikey,
        email: normalizedEmail,
      },
    });
  } catch (error) {
    console.error("[onboarding] Error in sync:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * POST /api/onboarding/complete
 * Add user to pending_extractions queue after successful cookie extraction
 */
router.post("/complete", async (req, res) => {
  try {
    const { email, firstName, school, inviteCode, identikey } = req.body;

    if (!email || !firstName || !school || !inviteCode) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedCode = inviteCode.toUpperCase().trim();

    // Check if user already exists in users table
    const { data: existingUser, error: checkUserError } = await supabase
      .from("users")
      .select("id, email")
      .eq("email", normalizedEmail)
      .single();

    if (checkUserError && checkUserError.code !== "PGRST116") {
      console.error(
        "[onboarding] Error checking existing user:",
        checkUserError,
      );
      return res.status(500).json({
        success: false,
        error: "Error checking existing user",
      });
    }

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: "User with this email already exists",
      });
    }

    // Check if user already in pending_extractions
    const { data: existingPending, error: checkPendingError } = await supabase
      .from("pending_extractions")
      .select("id, user_email")
      .eq("user_email", normalizedEmail)
      .single();

    if (checkPendingError && checkPendingError.code !== "PGRST116") {
      console.error(
        "[onboarding] Error checking pending extractions:",
        checkPendingError,
      );
      return res.status(500).json({
        success: false,
        error: "Error checking extraction queue",
      });
    }

    if (existingPending) {
      return res.json({
        success: true,
        message: "User already in extraction queue",
        data: {
          email: normalizedEmail,
          queuePosition: "pending",
        },
      });
    }

    // Get cookies from cookie file
    const cookieFile = getCookieFilename(normalizedEmail);
    let cookies = null;

    if (fs.existsSync(cookieFile)) {
      try {
        const cookieData = JSON.parse(fs.readFileSync(cookieFile, "utf8"));
        cookies = cookieData.cookies || null;
      } catch (error) {
        console.error("[onboarding] Error reading cookie file:", error);
        return res.status(500).json({
          success: false,
          error: "Cookie extraction failed. Please try again.",
        });
      }
    }

    if (!cookies) {
      return res.status(400).json({
        success: false,
        error: "No cookies found. Please complete authentication first.",
      });
    }

    // Create user in users table first
    const now = new Date().toISOString();
    const { data: newUser, error: userError } = await supabase
      .from("users")
      .insert({
        email: normalizedEmail,
        first_name: firstName,
        student: identikey || normalizedEmail.split("@")[0], // Use identikey or extract from email
        school: school,
        canvas_cookies: cookies,
        canvas_cookies_updated_at: now,
        last_login_at: now,
        invite_code_used: normalizedCode,
        onboarding_completed_at: now,
        preferences: {
          theme: "system",
          font: "default",
        },
        forum_data: {},
      })
      .select()
      .single();

    if (userError) {
      console.error("[onboarding] Error creating user:", userError);
      return res.status(500).json({
        success: false,
        error: "Failed to create user account",
      });
    }

    console.log(
      `[onboarding] Created user ${normalizedEmail} with ID ${newUser.id}`,
    );

    // Add user to pending_extractions table
    const { data: pendingEntry, error: insertError } = await supabase
      .from("pending_extractions")
      .insert({
        user_email: normalizedEmail,
        user_name: firstName,
        school: school,
        cookies: cookies,
        invite_code_used: normalizedCode,
        status: "pending",
      })
      .select()
      .single();

    if (insertError) {
      console.error(
        "[onboarding] Error adding to pending_extractions:",
        insertError,
      );
      return res.status(500).json({
        success: false,
        error: "Failed to add to extraction queue",
      });
    }

    // Increment invite code usage
    const { data: codeData, error: fetchError } = await supabase
      .from("invite_codes")
      .select("current_users")
      .eq("code", normalizedCode)
      .single();

    if (!fetchError && codeData) {
      const { error: updateCodeError } = await supabase
        .from("invite_codes")
        .update({
          current_users: (codeData.current_users || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("code", normalizedCode);

      if (updateCodeError) {
        console.error(
          "[onboarding] Error updating invite code usage:",
          updateCodeError,
        );
        // Don't fail the request - user is queued, just log the error
      }
    }

    console.log(
      `[onboarding] Added ${normalizedEmail} to pending_extractions queue`,
    );

    return res.json({
      success: true,
      message:
        "Added to extraction queue. You will receive an email within 24 hours.",
      data: {
        email: normalizedEmail,
        queueId: pendingEntry.id,
      },
    });
  } catch (error) {
    console.error("[onboarding] Error in complete:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

module.exports = router;
