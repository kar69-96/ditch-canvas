const express = require('express');
const fs = require('fs');
const path = require('path');

// Optional integrations - don't crash if module is not available
let getSupabaseClient = null;
let runAllSyncs = null;
try {
  getSupabaseClient = require('../services/integrations/supabase-client').getSupabaseClient;
  runAllSyncs = require('../services/integrations/sync-orchestrator').runAllSyncs;
} catch (error) {
  console.warn('⚠️  Integrations module not available, assignment completion updates will be limited:', error.message);
}

const router = express.Router();
const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'assignments.json');

async function listAssignments() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (_e) {
    return [];
  }
}

router.get('/', async (_req, res) => {
  try {
    const assignments = await listAssignments();
    return res.json({ success: true, data: assignments });
  } catch (error) {
    console.error('GET /assignments error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to load assignments' },
    });
  }
});

/**
 * PATCH /api/assignments/:assignmentId/complete
 * Update assignment completion status in Supabase
 * This is the single source of truth for completion status
 */
router.patch('/:assignmentId/complete', async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { userEmail, isCompleted, courseId } = req.body;

    if (!userEmail) {
      return res.status(400).json({ 
        success: false,
        error: 'userEmail is required' 
      });
    }

    if (typeof isCompleted !== 'boolean') {
      return res.status(400).json({ 
        success: false,
        error: 'isCompleted must be a boolean' 
      });
    }

    if (!getSupabaseClient) {
      return res.status(503).json({ 
        success: false,
        error: 'Supabase integration not available' 
      });
    }

    const supabase = getSupabaseClient();
    const normalizedEmail = userEmail.toLowerCase().trim();

    // First, get the existing assignment entity to preserve its data
    const { data: existingEntities, error: fetchError } = await supabase.rpc('get_user_entities', {
      user_email: normalizedEmail,
      entity_type_filter: 'assignment',
      course_id_filter: courseId ? String(courseId) : null,
    });

    if (fetchError) {
      console.error('[assignments] Error fetching assignment:', fetchError);
      return res.status(500).json({ 
        success: false,
        error: `Failed to fetch assignment: ${fetchError.message}` 
      });
    }

    // Find the assignment by ID
    const assignmentEntity = existingEntities?.find(
      entity => entity.entity_id === String(assignmentId) || entity.data?.id?.toString() === String(assignmentId) || entity.data?.assignmentId?.toString() === String(assignmentId)
    );

    if (!assignmentEntity) {
      return res.status(404).json({ 
        success: false,
        error: 'Assignment not found' 
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
    const { error: updateError } = await supabase.rpc('upsert_user_entity', {
      user_email: normalizedEmail,
      entity_type_val: 'assignment',
      entity_id_val: assignmentEntity.entity_id,
      data_val: updatedData,
      course_id_val: assignmentEntity.course_id || courseId ? String(courseId || assignmentEntity.course_id) : null,
      metadata_val: updatedMetadata,
    });

    if (updateError) {
      console.error('[assignments] Error updating assignment completion:', updateError);
      return res.status(500).json({ 
        success: false,
        error: `Failed to update assignment: ${updateError.message}` 
      });
    }

    // Trigger integration syncs to update all integrations
    if (runAllSyncs) {
      try {
        await runAllSyncs();
      } catch (syncError) {
        console.error('[assignments] Error syncing integrations after completion update:', syncError);
        // Don't fail the request if sync fails - the completion status was saved
      }
    }

    res.json({ 
      success: true,
      assignmentId,
      isCompleted,
      message: `Assignment marked as ${isCompleted ? 'complete' : 'incomplete'}`
    });
  } catch (error) {
    console.error('[assignments] Error updating completion status:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to update assignment completion status' 
    });
  }
});

module.exports = router;
