/**
 * Integration test fixtures
 * Static integration, invite code, and extraction queue data for testing
 */

// Google Sheets Integration
const googleSheetsIntegration = {
  id: 'int-google-1',
  user_email: 'test@colorado.edu',
  integration_type: 'google_sheets',
  credentials: {
    access_token: 'ya29.mock_access_token_google',
    refresh_token: 'mock_refresh_token_google',
    expiry_date: Date.now() + 3600000, // 1 hour from now
    token_type: 'Bearer',
    scope: 'https://www.googleapis.com/auth/spreadsheets',
  },
  target_id: 'spreadsheet_mock_123456',
  last_sync_at: '2026-01-08T10:00:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-08T10:00:00.000Z',
};

// Notion Integration
const notionIntegration = {
  id: 'int-notion-1',
  user_email: 'test@colorado.edu',
  integration_type: 'notion',
  credentials: {
    access_token: 'secret_mock_notion_token',
    bot_id: 'bot_mock_123',
    workspace_id: 'workspace_mock_456',
  },
  target_id: 'database_mock_789',
  last_sync_at: '2026-01-08T09:30:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-08T09:30:00.000Z',
};

// Expired Google Integration
const expiredGoogleIntegration = {
  id: 'int-google-2',
  user_email: 'student@colorado.edu',
  integration_type: 'google_sheets',
  credentials: {
    access_token: 'ya29.expired_token',
    refresh_token: 'mock_refresh_token_google_2',
    expiry_date: Date.now() - 86400000, // Expired 24 hours ago
    token_type: 'Bearer',
    scope: 'https://www.googleapis.com/auth/spreadsheets',
  },
  target_id: 'spreadsheet_mock_654321',
  last_sync_at: '2026-01-06T08:00:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-06T08:00:00.000Z',
};

// Integration Item Mappings
const googleSheetsMappings = [
  {
    id: 'mapping-1',
    integration_id: 'int-google-1',
    entity_type: 'assignment',
    entity_id: '789',
    external_id: 'row_5_spreadsheet_mock_123456',
    synced_at: '2026-01-08T10:00:00.000Z',
    created_at: '2026-01-08T10:00:00.000Z',
  },
  {
    id: 'mapping-2',
    integration_id: 'int-google-1',
    entity_type: 'assignment',
    entity_id: '790',
    external_id: 'row_6_spreadsheet_mock_123456',
    synced_at: '2026-01-08T10:01:00.000Z',
    created_at: '2026-01-08T10:01:00.000Z',
  },
];

const notionMappings = [
  {
    id: 'mapping-3',
    integration_id: 'int-notion-1',
    entity_type: 'assignment',
    entity_id: '789',
    external_id: 'page_notion_abc123',
    synced_at: '2026-01-08T09:30:00.000Z',
    created_at: '2026-01-08T09:30:00.000Z',
  },
  {
    id: 'mapping-4',
    integration_id: 'int-notion-1',
    entity_type: 'assignment',
    entity_id: '790',
    external_id: 'page_notion_def456',
    synced_at: '2026-01-08T09:31:00.000Z',
    created_at: '2026-01-08T09:31:00.000Z',
  },
];

// Invite Codes
const activeInviteCode = {
  id: 'invite-1',
  code: 'SPRING2026',
  max_users: 100,
  current_users: 42,
  expires_at: '2026-05-31T23:59:59.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-08T10:00:00.000Z',
};

const fullInviteCode = {
  id: 'invite-2',
  code: 'BETA2025',
  max_users: 50,
  current_users: 50,
  expires_at: '2026-12-31T23:59:59.000Z',
  created_at: '2025-12-01T00:00:00.000Z',
  updated_at: '2026-01-05T15:00:00.000Z',
};

const expiredInviteCode = {
  id: 'invite-3',
  code: 'FALL2025',
  max_users: 100,
  current_users: 87,
  expires_at: '2025-12-31T23:59:59.000Z',
  created_at: '2025-08-01T00:00:00.000Z',
  updated_at: '2025-12-20T10:00:00.000Z',
};

// Pending Extractions
const pendingExtraction1 = {
  id: 'pending-1',
  user_email: 'newuser1@colorado.edu',
  user_name: 'New User 1',
  school: 'University of Colorado - Boulder',
  cookies: [
    {
      name: 'canvas_session',
      value: 'session_token_newuser1',
      domain: '.canvas.colorado.edu',
      path: '/',
      secure: true,
      httpOnly: true,
    },
  ],
  invite_code_used: 'SPRING2026',
  status: 'pending',
  retry_count: 0,
  last_error: null,
  created_at: '2026-01-08T14:00:00.000Z',
  updated_at: '2026-01-08T14:00:00.000Z',
};

const inProgressExtraction = {
  id: 'pending-2',
  user_email: 'newuser2@colorado.edu',
  user_name: 'New User 2',
  school: 'University of Colorado - Boulder',
  cookies: [
    {
      name: 'canvas_session',
      value: 'session_token_newuser2',
      domain: '.canvas.colorado.edu',
      path: '/',
      secure: true,
      httpOnly: true,
    },
  ],
  invite_code_used: 'SPRING2026',
  status: 'in_progress',
  retry_count: 0,
  last_error: null,
  created_at: '2026-01-08T13:00:00.000Z',
  updated_at: '2026-01-08T14:30:00.000Z',
};

const failedExtraction = {
  id: 'pending-3',
  user_email: 'newuser3@colorado.edu',
  user_name: 'New User 3',
  school: 'University of Colorado - Boulder',
  cookies: [
    {
      name: 'canvas_session',
      value: 'session_token_newuser3',
      domain: '.canvas.colorado.edu',
      path: '/',
      secure: true,
      httpOnly: true,
    },
  ],
  invite_code_used: 'SPRING2026',
  status: 'failed',
  retry_count: 3,
  last_error: 'Authentication failed: Invalid cookies',
  created_at: '2026-01-07T10:00:00.000Z',
  updated_at: '2026-01-08T08:00:00.000Z',
};

// Completed Extractions
const completedExtraction1 = {
  id: 'completed-1',
  user_email: 'test@colorado.edu',
  extraction_date: '2026-01-01T10:00:00.000Z',
  status: 'success',
  total_courses: 3,
  total_assignments: 12,
  total_files: 108,
  total_modules: 15,
  error_message: null,
  created_at: '2026-01-01T10:00:00.000Z',
  updated_at: '2026-01-01T11:30:00.000Z',
};

const completedExtraction2 = {
  id: 'completed-2',
  user_email: 'student@colorado.edu',
  extraction_date: '2026-01-02T14:00:00.000Z',
  status: 'success',
  total_courses: 4,
  total_assignments: 18,
  total_files: 142,
  total_modules: 20,
  error_message: null,
  created_at: '2026-01-02T14:00:00.000Z',
  updated_at: '2026-01-02T15:45:00.000Z',
};

// Waitlist Entries
const waitlistEntry1 = {
  id: 'waitlist-1',
  email: 'waitlist1@other.edu',
  name: 'Waitlist User 1',
  school: 'Other University',
  position: 1,
  created_at: '2026-01-05T10:00:00.000Z',
};

const waitlistEntry2 = {
  id: 'waitlist-2',
  email: 'waitlist2@mit.edu',
  name: 'Waitlist User 2',
  school: 'Massachusetts Institute of Technology',
  position: 2,
  created_at: '2026-01-06T12:00:00.000Z',
};

module.exports = {
  googleSheetsIntegration,
  notionIntegration,
  expiredGoogleIntegration,
  googleSheetsMappings,
  notionMappings,
  activeInviteCode,
  fullInviteCode,
  expiredInviteCode,
  pendingExtraction1,
  inProgressExtraction,
  failedExtraction,
  completedExtraction1,
  completedExtraction2,
  waitlistEntry1,
  waitlistEntry2,

  // Arrays for bulk operations
  allIntegrations: [googleSheetsIntegration, notionIntegration, expiredGoogleIntegration],
  allInviteCodes: [activeInviteCode, fullInviteCode, expiredInviteCode],
  allPendingExtractions: [pendingExtraction1, inProgressExtraction, failedExtraction],
  allCompletedExtractions: [completedExtraction1, completedExtraction2],
  allWaitlistEntries: [waitlistEntry1, waitlistEntry2],

  // Helper to get integration by type
  getIntegrationByType: (userEmail, type) =>
    [googleSheetsIntegration, notionIntegration, expiredGoogleIntegration].find(
      i => i.user_email === userEmail && i.integration_type === type
    ),

  // Helper to check if invite code is valid
  isInviteCodeValid: (code) => {
    const invite = [activeInviteCode, fullInviteCode, expiredInviteCode].find(i => i.code === code);
    if (!invite) return false;
    if (invite.current_users >= invite.max_users) return false;
    if (new Date(invite.expires_at) < new Date()) return false;
    return true;
  },
};
