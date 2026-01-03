const { google } = require('googleapis');
const { hashAssignment } = require('../../utils/hash-helpers');

async function syncGoogleSheet({ integration, token, assignments, supabase }) {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials(token);

  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
  const spreadsheetId = integration.external_target_id;

  // Group assignments by date
  const assignmentsByDate = new Map();
  
  assignments.forEach((assignment) => {
    const dueDate = assignment.due_date ? new Date(assignment.due_date) : null;
    if (!dueDate || isNaN(dueDate.getTime())) {
      // Assignments without due dates go to "No Due Date"
      const key = 'No Due Date';
      if (!assignmentsByDate.has(key)) {
        assignmentsByDate.set(key, []);
      }
      assignmentsByDate.get(key).push(assignment);
    } else {
      // Format date as YYYY-MM-DD for grouping
      const dateKey = dueDate.toISOString().split('T')[0];
      const displayDate = dueDate.toLocaleDateString('en-US', { 
        weekday: 'long', 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric' 
      });
      
      if (!assignmentsByDate.has(dateKey)) {
        assignmentsByDate.set(dateKey, { displayDate, assignments: [] });
      }
      assignmentsByDate.get(dateKey).assignments.push(assignment);
    }
  });

  // Sort dates (except "No Due Date" which goes last)
  const sortedDates = Array.from(assignmentsByDate.entries()).sort((a, b) => {
    if (a[0] === 'No Due Date') return 1;
    if (b[0] === 'No Due Date') return -1;
    return a[0].localeCompare(b[0]);
  });

  // Build the sheet data
  const allRows = [];
  
  // Header row
  allRows.push(['Date', 'Assignment', 'Course', 'Due Time', 'Points', 'Status', 'URL', 'Completed']);

  // Add assignments grouped by date
  sortedDates.forEach(([dateKey, data]) => {
    const assignments = dateKey === 'No Due Date' ? data : data.assignments;
    const displayDate = dateKey === 'No Due Date' ? dateKey : data.displayDate;
    
    // Sort assignments within each day by due time (if available)
    const sortedAssignments = assignments.sort((a, b) => {
      const timeA = a.due_date ? new Date(a.due_date).getTime() : 0;
      const timeB = b.due_date ? new Date(b.due_date).getTime() : 0;
      return timeA - timeB;
    });

    sortedAssignments.forEach((assignment, idx) => {
      const dueDate = assignment.due_date ? new Date(assignment.due_date) : null;
      const dueTime = dueDate && !isNaN(dueDate.getTime()) 
        ? dueDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        : '';
      
      // Check if assignment is completed
      // The isCompleted flag is already set by the sync orchestrator, which includes:
      // - User-marked completions (from completedAssignmentIds in integration config)
      // - Canvas submission status (submissionStatus === "yes" or workflow_state is "submitted"/"graded")
      // User-marked completions take precedence and persist through updates
      // We also check submission status directly as a fallback for safety
      const submissionStatus = assignment.submission_status || assignment.submissionStatus;
      const submissionStatusText = assignment.submissionStatusText || assignment.submission_status_text;
      const workflowState = assignment.workflow_state || assignment.workflowState;
      
      const isCompleted = 
        assignment.isCompleted === true || // From sync orchestrator (includes user-marked + Canvas status)
        submissionStatus === "yes" || // Fallback check
        workflowState === "submitted" || // Fallback check
        workflowState === "graded" || // Fallback check
        (submissionStatusText && (
          submissionStatusText.toLowerCase().includes('submitted') ||
          submissionStatusText.toLowerCase().includes('graded') ||
          submissionStatusText.toLowerCase().includes('complete')
        ));
      
      allRows.push([
        idx === 0 ? displayDate : '', // Only show date in first row of each day
        assignment.title || '',
        assignment.course_code || assignment.course_name || '',
        dueTime,
        assignment.points_possible || assignment.points || '',
        assignment.workflow_state || 'pending',
        assignment.url || '',
        isCompleted, // Checkbox value (true = checked if completed)
      ]);
    });
  });

  // Clear the entire sheet first
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: 'Assignments!A:Z',
  });

  // Write all data
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Assignments!A1:H${allRows.length}`,
    valueInputOption: 'RAW',
    requestBody: { values: allRows },
  });

  // Get the actual sheet ID (first sheet in the spreadsheet)
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetId = spreadsheet.data.sheets[0]?.properties?.sheetId;
  if (!sheetId && sheetId !== 0) {
    throw new Error('Could not find sheet ID');
  }

  // Format the sheet: add checkboxes, bold headers, freeze first row
  const requests = [
    // Freeze header row
    {
      updateSheetProperties: {
        properties: {
          sheetId: sheetId,
          gridProperties: {
            frozenRowCount: 1,
          },
        },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    // Format header row (bold, background color)
    {
      repeatCell: {
        range: {
          sheetId: sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.2, green: 0.4, blue: 0.8 },
            textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
      },
    },
    // Add checkboxes to the "Completed" column (column H)
    {
      repeatCell: {
        range: {
          sheetId: sheetId,
          startRowIndex: 1, // Skip header
          endRowIndex: allRows.length,
          startColumnIndex: 7, // Column H (0-indexed)
          endColumnIndex: 8,
        },
        cell: {
          dataValidation: {
            condition: {
              type: 'BOOLEAN',
            },
            strict: true,
            showCustomUi: true,
          },
        },
        fields: 'dataValidation',
      },
    },
    // Auto-resize columns
    {
      autoResizeDimensions: {
        dimensions: {
          sheetId: sheetId,
          dimension: 'COLUMNS',
          startIndex: 0,
          endIndex: 8,
        },
      },
    },
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });

  // Upsert mappings for idempotent sync
  const mappings = [];
  let rowIndex = 1; // Start after header
  
  sortedDates.forEach(([dateKey, data]) => {
    const assignments = dateKey === 'No Due Date' ? data : data.assignments;
    assignments.forEach((assignment) => {
      const internalId = assignment.assignment_id || assignment.id?.toString() || assignment.internalId;
      if (internalId) {
        mappings.push({
          integration_id: integration.id,
          item_type: 'assignment',
          internal_id: internalId,
          external_id: `Assignments!B${rowIndex + 1}`, // Use title cell as reference
          content_hash: assignment.contentHash || hashAssignment(assignment),
        });
      }
      rowIndex++;
    });
  });

  if (mappings.length) {
    const { error } = await supabase
      .from('integration_item_mappings')
      .upsert(mappings, { onConflict: 'integration_id,item_type,internal_id' });
    if (error) throw new Error(`Failed to upsert mappings: ${error.message}`);
  }
}

module.exports = syncGoogleSheet;
