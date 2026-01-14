/**
 * User test fixtures
 * Static user data for testing
 */

const validUser = {
  id: 'user-123',
  email: 'test@colorado.edu',
  name: 'Test User',
  school: 'University of Colorado - Boulder',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const userWithCookies = {
  id: 'user-456',
  email: 'student@colorado.edu',
  name: 'Student User',
  school: 'University of Colorado - Boulder',
  cookies: [
    {
      name: 'canvas_session',
      value: 'abc123def456',
      domain: '.canvas.colorado.edu',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'None',
    },
    {
      name: '_csrf_token',
      value: 'token789xyz',
      domain: '.canvas.colorado.edu',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const userWithSession = {
  id: 'user-789',
  email: 'active@colorado.edu',
  name: 'Active User',
  school: 'University of Colorado - Boulder',
  session: {
    id: 'session-abc',
    user_id: 'user-789',
    token: 'session-token-123',
    expires_at: '2026-12-31T23:59:59.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
  },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const newUser = {
  email: 'newuser@colorado.edu',
  name: 'New User',
  school: 'University of Colorado - Boulder',
};

const userFromOtherSchool = {
  id: 'user-999',
  email: 'student@mit.edu',
  name: 'MIT Student',
  school: 'Massachusetts Institute of Technology',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const userWithInviteCode = {
  id: 'user-111',
  email: 'invited@colorado.edu',
  name: 'Invited User',
  school: 'University of Colorado - Boulder',
  invite_code_used: 'SPRING2026',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const userWithIntegrations = {
  id: 'user-222',
  email: 'integrated@colorado.edu',
  name: 'Integrated User',
  school: 'University of Colorado - Boulder',
  integrations: [
    {
      id: 'int-1',
      user_email: 'integrated@colorado.edu',
      integration_type: 'google_sheets',
      credentials: {
        access_token: 'google-token-123',
        refresh_token: 'google-refresh-123',
        expiry_date: Date.now() + 3600000,
      },
      target_id: 'spreadsheet-123',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'int-2',
      user_email: 'integrated@colorado.edu',
      integration_type: 'notion',
      credentials: {
        access_token: 'notion-token-456',
      },
      target_id: 'database-456',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  ],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const adminUser = {
  id: 'user-admin',
  email: 'admin@colorado.edu',
  name: 'Admin User',
  school: 'University of Colorado - Boulder',
  role: 'admin',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const sampleCookies = [
  {
    name: 'canvas_session',
    value: 'abc123def456ghi789',
    domain: '.canvas.colorado.edu',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'None',
    expires: Date.now() + 86400000, // 24 hours from now
  },
  {
    name: '_csrf_token',
    value: 'csrf-token-xyz123',
    domain: '.canvas.colorado.edu',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    expires: Date.now() + 86400000,
  },
  {
    name: 'user_id',
    value: '12345',
    domain: '.canvas.colorado.edu',
    path: '/',
    secure: false,
    httpOnly: false,
    sameSite: 'Lax',
    expires: Date.now() + 86400000,
  },
];

module.exports = {
  validUser,
  userWithCookies,
  userWithSession,
  newUser,
  userFromOtherSchool,
  userWithInviteCode,
  userWithIntegrations,
  adminUser,
  sampleCookies,

  // Array of all users for bulk seeding
  allUsers: [
    validUser,
    userWithCookies,
    userWithSession,
    userFromOtherSchool,
    userWithInviteCode,
    userWithIntegrations,
    adminUser,
  ],
};
