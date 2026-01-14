/**
 * Users API Routes
 * Uses service key to access Supabase users table (bypasses RLS)
 */

const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const { getSupabaseConfig } = require("../core/config");

const router = express.Router();

// Initialize Supabase client with service key
const supabaseConfig = getSupabaseConfig();
const supabase = createClient(supabaseConfig.url, supabaseConfig.serviceKey);

/**
 * GET /api/users/:userId
 * Get user by UUID
 */
router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res
          .status(404)
          .json({ success: false, error: "User not found" });
      }
      console.error("[users] Error getting user:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, user: data });
  } catch (error) {
    console.error("[users] Exception:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/users/by-email/:email
 * Get user by email
 */
router.get("/by-email/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const normalizedEmail = email.toLowerCase().trim();

    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", normalizedEmail)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res
          .status(404)
          .json({ success: false, error: "User not found" });
      }
      console.error("[users] Error getting user by email:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, user: data });
  } catch (error) {
    console.error("[users] Exception:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /api/users/:userId
 * Update user
 */
router.patch("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const updates = req.body;

    // Add updated_at timestamp
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", userId)
      .select()
      .single();

    if (error) {
      console.error("[users] Error updating user:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, user: data });
  } catch (error) {
    console.error("[users] Exception:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /api/users/:userId/last-login
 * Update user's last login timestamp
 */
router.patch("/:userId/last-login", async (req, res) => {
  try {
    const { userId } = req.params;

    const { error } = await supabase
      .from("users")
      .update({
        last_login_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (error) {
      console.error("[users] Error updating last login:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("[users] Exception:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/users/:userId
 * Delete user and all associated data
 */
router.delete("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { email } = req.query;

    if (!email) {
      return res
        .status(400)
        .json({ success: false, error: "Email is required" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    console.log(
      `[users] Deleting user ${userId} with email ${normalizedEmail}`,
    );

    // Delete extraction data
    const { error: extractionError } = await supabase
      .from("extraction_data")
      .delete()
      .eq("user_email", normalizedEmail);

    if (extractionError) {
      console.error("[users] Error deleting extraction data:", extractionError);
      // Continue with deletion even if this fails
    }

    // Delete integrations
    const { error: integrationsError } = await supabase
      .from("integrations")
      .delete()
      .eq("user_email", normalizedEmail);

    if (integrationsError) {
      console.error("[users] Error deleting integrations:", integrationsError);
      // Continue with deletion even if this fails
    }

    // Delete chat data (posts, responses, votes) by user email
    const { error: chatPostsError } = await supabase
      .from("chat_posts")
      .delete()
      .eq("user_email", normalizedEmail);

    if (chatPostsError) {
      console.error("[users] Error deleting chat posts:", chatPostsError);
    }

    const { error: chatResponsesError } = await supabase
      .from("chat_responses")
      .delete()
      .eq("user_email", normalizedEmail);

    if (chatResponsesError) {
      console.error(
        "[users] Error deleting chat responses:",
        chatResponsesError,
      );
    }

    const { error: chatVotesError } = await supabase
      .from("chat_votes")
      .delete()
      .eq("user_email", normalizedEmail);

    if (chatVotesError) {
      console.error("[users] Error deleting chat votes:", chatVotesError);
    }

    // Delete sessions
    const { error: sessionsError } = await supabase
      .from("sessions")
      .delete()
      .eq("user_id", userId);

    if (sessionsError) {
      console.error("[users] Error deleting sessions:", sessionsError);
    }

    // Finally, delete the user record
    const { error: userError } = await supabase
      .from("users")
      .delete()
      .eq("id", userId);

    if (userError) {
      console.error("[users] Error deleting user:", userError);
      return res.status(500).json({ success: false, error: userError.message });
    }

    console.log(`[users] Successfully deleted user ${userId}`);
    res.json({ success: true });
  } catch (error) {
    console.error("[users] Exception during delete:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
