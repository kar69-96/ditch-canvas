const express = require("express");
const fs = require("fs");
const path = require("path");

// Optional integrations - don't crash if module is not available
let getSupabaseClient = null;
let runAllSyncs = null;
try {
  getSupabaseClient =
    require("../services/integrations/supabase-client").getSupabaseClient;
  runAllSyncs =
    require("../services/integrations/sync-orchestrator").runAllSyncs;
} catch (error) {
  console.warn(
    "⚠️  Integrations module not available, assignment completion updates will be limited:",
    error.message,
  );
}

const router = express.Router();
const DATA_FILE = path.join(__dirname, "..", "..", "data", "assignments.json");

async function listAssignments() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw);
  } catch (_e) {
    return [];
  }
}

router.get("/", async (_req, res) => {
  try {
    const assignments = await listAssignments();
    return res.json({ success: true, data: assignments });
  } catch (error) {
    console.error("GET /assignments error:", error);
    return res.status(500).json({
      success: false,
      error: { message: "Failed to load assignments" },
    });
  }
});

/**
 * Helper: Get user ID from email
 */
async function getUserIdByEmail(supabase, userEmail) {
  const normalizedEmail = userEmail.toLowerCase().trim();
  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("email", normalizedEmail)
    .single();

  if (error || !data) {
    throw new Error(`User not found: ${userEmail}`);
  }
  return data.id;
}

/**
 * PATCH /api/assignments/:assignmentId/complete
 * Update assignment completion status in Supabase
 * This is the single source of truth for completion status
 */
router.patch("/:assignmentId/complete", async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { userEmail, isCompleted, courseId } = req.body;

    if (!userEmail) {
      return res.status(400).json({
        success: false,
        error: "userEmail is required",
      });
    }

    if (typeof isCompleted !== "boolean") {
      return res.status(400).json({
        success: false,
        error: "isCompleted must be a boolean",
      });
    }

    if (!getSupabaseClient) {
      return res.status(503).json({
        success: false,
        error: "Supabase integration not available",
      });
    }

    const supabase = getSupabaseClient();

    // Get user ID from email
    let userId;
    try {
      userId = await getUserIdByEmail(supabase, userEmail);
    } catch (userError) {
      return res.status(404).json({
        success: false,
        error: userError.message,
      });
    }

    // First, get the existing assignment entity to preserve its data
    const { data: existingEntities, error: fetchError } = await supabase.rpc(
      "get_user_entities",
      {
        p_user_id: userId,
        p_entity_type: "assignment",
        p_course_id: courseId ? String(courseId) : null,
      },
    );

    if (fetchError) {
      console.error("[assignments] Error fetching assignment:", fetchError);
      return res.status(500).json({
        success: false,
        error: `Failed to fetch assignment: ${fetchError.message}`,
      });
    }

    // Find the assignment by ID
    const assignmentEntity = existingEntities?.find(
      (entity) =>
        entity.entity_id === String(assignmentId) ||
        entity.data?.id?.toString() === String(assignmentId) ||
        entity.data?.assignmentId?.toString() === String(assignmentId),
    );

    if (!assignmentEntity) {
      return res.status(404).json({
        success: false,
        error: "Assignment not found",
      });
    }

    // Update the assignment data/metadata to include user-marked completion status
    const existingData = assignmentEntity.data || {};
    const existingMetadata = assignmentEntity.metadata || {};

    // Store completion status in metadata (separate from Canvas submission status)
    const updatedMetadata = {
      ...existingMetadata,
      userMarkedComplete: isCompleted,
      userMarkedCompleteAt: isCompleted ? new Date().toISOString() : null,
    };

    // Also update the data field for backward compatibility
    const updatedData = {
      ...existingData,
      userMarkedComplete: isCompleted,
    };

    // Upsert the assignment with updated completion status
    const { error: updateError } = await supabase.rpc("upsert_user_entity", {
      p_user_id: userId,
      p_entity_type: "assignment",
      p_entity_id: assignmentEntity.entity_id,
      p_course_id:
        assignmentEntity.course_id || courseId
          ? String(courseId || assignmentEntity.course_id)
          : null,
      p_data: updatedData,
      p_metadata: updatedMetadata,
    });

    if (updateError) {
      console.error(
        "[assignments] Error updating assignment completion:",
        updateError,
      );
      return res.status(500).json({
        success: false,
        error: `Failed to update assignment: ${updateError.message}`,
      });
    }

    // Trigger integration syncs to update all integrations
    if (runAllSyncs) {
      try {
        await runAllSyncs();
      } catch (syncError) {
        console.error(
          "[assignments] Error syncing integrations after completion update:",
          syncError,
        );
        // Don't fail the request if sync fails - the completion status was saved
      }
    }

    res.json({
      success: true,
      assignmentId,
      isCompleted,
      message: `Assignment marked as ${isCompleted ? "complete" : "incomplete"}`,
    });
  } catch (error) {
    console.error("[assignments] Error updating completion status:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to update assignment completion status",
    });
  }
});

module.exports = router;
