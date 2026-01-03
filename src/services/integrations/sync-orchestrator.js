const { getSupabaseClient } = require('./supabase-client');
const { decryptToken } = require('./token-crypto');
const { hashAssignment } = require('../../utils/hash-helpers');
const syncGoogle = require('./google-sheets-sync');
const syncNotion = require('./notion-sync');

async function fetchActiveIntegrations() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('integrations')
    .select('*')
    .eq('status', 'active');
  if (error) throw new Error(`Failed to fetch integrations: ${error.message}`);
  return data || [];
}

async function fetchAssignments(userEmail) {
  const supabase = getSupabaseClient();
  
  // Try flexible storage first (new schema-less system)
  try {
    const { data: entities, error: entitiesError } = await supabase.rpc('get_user_entities', {
      user_email: userEmail,
      entity_type_filter: 'assignment',
      course_id_filter: null,
    });

    if (!entitiesError && entities && entities.length > 0) {
      // Map flexible storage entities to expected format
      return entities.map((entity) => {
        const data = entity.data || {};
        const metadata = entity.metadata || {};
        const internalId = data.id?.toString() || entity.entity_id;
        
        // Check if assignment is completed
        // Priority: userMarkedComplete (from Supabase) > Canvas submission status
        // userMarkedComplete is stored in metadata.userMarkedComplete or data.userMarkedComplete
        const userMarkedComplete = metadata.userMarkedComplete === true || data.userMarkedComplete === true;
        
        // Canvas submission status (from Canvas data)
        const submissionStatus = data.submissionStatus || data.submission_status;
        const workflowState = data.workflowState || data.workflow_state;
        const isCanvasComplete = 
          submissionStatus === "yes" || 
          workflowState === "submitted" ||
          workflowState === "graded";
        
        // Final completion status: user-marked takes precedence, fallback to Canvas status
        const isCompleted = userMarkedComplete || isCanvasComplete;
        
        return {
          assignment_id: data.id?.toString(),
          id: data.id,
          title: data.title || data.name,
          course_code: data.courseCode || data.course_code,
          course_name: data.courseName || data.course_name,
          course_id: data.courseId || data.course_id,
          due_date: data.dueAt || data.due_date || data.dueDate,
          workflow_state: data.workflowState || data.workflow_state || 'pending',
          url: data.url,
          points_possible: data.pointsPossible || data.points_possible,
          submission_status: data.submissionStatus || data.submission_status,
          submission_status_text: data.submissionStatusText || data.submission_status_text,
          isCompleted,
          internalId,
          contentHash: hashAssignment({
            title: data.title || data.name,
            course_code: data.courseCode || data.course_code,
            due_date: data.dueAt || data.due_date,
            points_possible: data.pointsPossible || data.points_possible,
            workflow_state: data.workflowState || data.workflow_state,
            url: data.url,
          }),
        };
      });
    }
  } catch (flexError) {
    console.log('[sync] Flexible storage not available, trying traditional table');
  }

  // Fallback to traditional assignments table
  const { data, error } = await supabase
    .from('assignments')
    .select(
      'assignment_id,id,title,course_code,course_name,course_id,due_date,workflow_state,url,points_possible'
    )
    .eq('user_email', userEmail)
    .order('due_date', { ascending: true, nullsFirst: false });
  
  if (error) throw new Error(`Failed to fetch assignments: ${error.message}`);

  // Include ALL assignments (pending, submitted, graded, completed)
  return (data || []).map((a) => {
    const internalId = a.assignment_id || a.id?.toString();
    return {
      ...a,
      internalId,
      contentHash: hashAssignment(a),
    };
  });
}

async function updateSyncStatus(integrationId, { status, error }) {
  const supabase = getSupabaseClient();
  const payload = {
    last_sync_at: new Date().toISOString(),
    last_sync_status: status,
    last_sync_error: error || null,
    status: status === 'needs_reauth' ? 'needs_reauth' : 'active',
  };
  const { error: supabaseError } = await supabase
    .from('integrations')
    .update(payload)
    .eq('id', integrationId);
  if (supabaseError) {
    console.error('[sync] failed to update sync status', supabaseError);
  }
}

async function runIntegration(integration, assignments) {
  const supabase = getSupabaseClient();
  let token;
  try {
    token = decryptToken(integration.token_ciphertext);
  } catch (err) {
    await updateSyncStatus(integration.id, { status: 'needs_reauth', error: err.message });
    throw new Error(`Token decrypt failed: ${err.message}`);
  }

  if (!assignments || assignments.length === 0) {
    await updateSyncStatus(integration.id, { status: 'success', error: null });
    return;
  }

  // Completion status is now read directly from Supabase assignment entities
  // (stored in metadata.userMarkedComplete or data.userMarkedComplete)
  // The isCompleted flag is already set correctly in fetchAssignments()
  // No need to merge with integration config - Supabase is the single source of truth

  if (integration.provider === 'google') {
    await syncGoogle({
      integration,
      token,
      assignments,
      supabase,
    });
    await updateSyncStatus(integration.id, { status: 'success', error: null });
    return;
  }

  if (integration.provider === 'notion') {
    await syncNotion({
      integration,
      token,
      assignments,
      supabase,
    });
    await updateSyncStatus(integration.id, { status: 'success', error: null });
    return;
  }

  throw new Error(`Unsupported provider: ${integration.provider}`);
}

async function runAllSyncs() {
  const integrations = await fetchActiveIntegrations();
  if (!integrations.length) return { ran: 0 };

  // Group assignments fetch per user to reduce roundtrips
  const byUser = new Map();
  for (const integ of integrations) {
    if (!byUser.has(integ.user_email)) {
      byUser.set(integ.user_email, await fetchAssignments(integ.user_email));
    }
  }

  let success = 0;
  for (const integration of integrations) {
    try {
      const assignments = byUser.get(integration.user_email) || [];
      await runIntegration(integration, assignments);
      success += 1;
    } catch (err) {
      console.error('[sync] integration failed', {
        provider: integration.provider,
        user: integration.user_email,
        error: err,
      });
      await updateSyncStatus(integration.id, { status: 'needs_reauth', error: err.message });
    }
  }

  return { ran: integrations.length, success };
}

module.exports = {
  runAllSyncs,
};

