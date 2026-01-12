const { Client } = require('@notionhq/client');

async function fetchExistingMappings(supabase, integrationId) {
  const { data, error } = await supabase
    .from('integration_item_mappings')
    .select('internal_id, external_id, content_hash')
    .eq('integration_id', integrationId);
  if (error) throw new Error(`Failed to fetch mappings: ${error.message}`);
  const map = new Map();
  (data || []).forEach((row) => {
    map.set(row.internal_id, { externalId: row.external_id, contentHash: row.content_hash });
  });
  return map;
}

function buildProperties(assignment) {
  const title = assignment.title || 'Untitled';
  const course = assignment.course_code || assignment.courseCode || '';
  const due = assignment.due_date || assignment.dueDate || null;
  const points = assignment.points_possible ?? assignment.pointsPossible ?? null;
  const url = assignment.url || null;

  // Determine status from isCompleted flag (set by sync-orchestrator from user-marked or Canvas submission)
  // Available options in Notion database: 'pending', 'submitted', 'graded'
  let status = 'pending';
  if (assignment.isCompleted) {
    // Check if it was graded (Canvas submission status) vs just submitted/marked complete
    const workflowState = assignment.workflow_state || assignment.workflowState;
    status = workflowState === 'graded' ? 'graded' : 'submitted';
  }

  return {
    Name: {
      title: [{ text: { content: title } }],
    },
    Course: {
      rich_text: course ? [{ text: { content: course } }] : [],
    },
    Due: due ? { date: { start: new Date(due).toISOString() } } : { date: null },
    Points: { number: points ?? null },
    Status: { select: { name: status } },
    URL: { url },
  };
}

async function upsertMapping(supabase, integrationId, assignment) {
  const { error } = await supabase.from('integration_item_mappings').upsert(
    {
      integration_id: integrationId,
      item_type: 'assignment',
      internal_id: assignment.internalId,
      external_id: assignment.externalId,
      content_hash: assignment.contentHash,
    },
    { onConflict: 'integration_id,item_type,internal_id' }
  );
  if (error) throw new Error(`Failed to upsert mapping: ${error.message}`);
}

async function syncNotion({ integration, token, assignments, supabase }) {
  const notion = new Client({ auth: token.access_token || token.token || token.bot_id });
  const databaseId = integration.external_target_id;
  const existingMappings = await fetchExistingMappings(supabase, integration.id);

  for (const assignment of assignments) {
    const existing = existingMappings.get(assignment.internalId);
    if (existing && existing.contentHash === assignment.contentHash) {
      continue; // unchanged
    }

    const properties = buildProperties(assignment);

    if (existing && existing.externalId) {
      // Update
      await notion.pages.update({
        page_id: existing.externalId,
        properties,
      });
      assignment.externalId = existing.externalId;
    } else {
      // Create
      const page = await notion.pages.create({
        parent: { database_id: databaseId },
        properties,
      });
      assignment.externalId = page.id;
    }

    await upsertMapping(supabase, integration.id, assignment);
  }
}

module.exports = syncNotion;
