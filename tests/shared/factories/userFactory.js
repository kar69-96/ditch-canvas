/**
 * User factory for generating test user data
 * Uses @faker-js/faker for realistic random data
 */

const { faker } = require('@faker-js/faker');

/**
 * Create a single user with optional overrides
 * @param {Object} overrides - Properties to override
 * @returns {Object} User object
 */
function createUser(overrides = {}) {
  const firstName = overrides.firstName || faker.person.firstName();
  const lastName = overrides.lastName || faker.person.lastName();
  const email = overrides.email || `${firstName.toLowerCase()}.${lastName.toLowerCase()}@colorado.edu`;

  return {
    id: faker.string.uuid(),
    email,
    name: `${firstName} ${lastName}`,
    school: 'University of Colorado - Boulder',
    created_at: faker.date.past({ years: 1 }).toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create multiple users
 * @param {number} count - Number of users to create
 * @param {Object} overrides - Properties to override for all users
 * @returns {Array} Array of user objects
 */
function createUsers(count, overrides = {}) {
  return Array.from({ length: count }, () => createUser(overrides));
}

/**
 * Create a user with cookies
 * @param {Object} overrides - Properties to override
 * @returns {Object} User object with cookies
 */
function createUserWithCookies(overrides = {}) {
  return createUser({
    cookies: createCookies(),
    ...overrides,
  });
}

/**
 * Create a user with a session
 * @param {Object} overrides - Properties to override
 * @returns {Object} User object with session
 */
function createUserWithSession(overrides = {}) {
  const userId = overrides.id || faker.string.uuid();
  return createUser({
    id: userId,
    session: {
      id: faker.string.uuid(),
      user_id: userId,
      token: faker.string.alphanumeric(32),
      expires_at: faker.date.future({ years: 1 }).toISOString(),
      created_at: faker.date.past({ months: 1 }).toISOString(),
    },
    ...overrides,
  });
}

/**
 * Create cookies for authentication
 * @param {Object} overrides - Properties to override
 * @returns {Array} Array of cookie objects
 */
function createCookies(overrides = {}) {
  const domain = overrides.domain || '.canvas.colorado.edu';

  return [
    {
      name: 'canvas_session',
      value: faker.string.alphanumeric(40),
      domain,
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'None',
      expires: Date.now() + 86400000,
    },
    {
      name: '_csrf_token',
      value: faker.string.alphanumeric(32),
      domain,
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      expires: Date.now() + 86400000,
    },
    {
      name: 'user_id',
      value: faker.number.int({ min: 10000, max: 99999 }).toString(),
      domain,
      path: '/',
      secure: false,
      httpOnly: false,
      sameSite: 'Lax',
      expires: Date.now() + 86400000,
    },
  ];
}

/**
 * Create a user with integrations
 * @param {Object} overrides - Properties to override
 * @returns {Object} User object with integrations
 */
function createUserWithIntegrations(overrides = {}) {
  const userEmail = overrides.email || createUser().email;

  return createUser({
    email: userEmail,
    integrations: [
      {
        id: faker.string.uuid(),
        user_email: userEmail,
        integration_type: 'google_sheets',
        credentials: {
          access_token: `ya29.${faker.string.alphanumeric(100)}`,
          refresh_token: faker.string.alphanumeric(50),
          expiry_date: Date.now() + 3600000,
          token_type: 'Bearer',
          scope: 'https://www.googleapis.com/auth/spreadsheets',
        },
        target_id: `spreadsheet_${faker.string.alphanumeric(20)}`,
        created_at: faker.date.past({ months: 3 }).toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    ...overrides,
  });
}

/**
 * Create a CU Boulder student user
 * @param {Object} overrides - Properties to override
 * @returns {Object} User object
 */
function createCUBoulderStudent(overrides = {}) {
  return createUser({
    school: 'University of Colorado - Boulder',
    ...overrides,
  });
}

/**
 * Create a non-CU student user (for waitlist testing)
 * @param {Object} overrides - Properties to override
 * @returns {Object} User object
 */
function createNonCUStudent(overrides = {}) {
  const schools = [
    'Massachusetts Institute of Technology',
    'Stanford University',
    'Harvard University',
    'University of California, Berkeley',
    'California Institute of Technology',
  ];

  const school = faker.helpers.arrayElement(schools);
  const domain = school.split(' ')[0].toLowerCase() + '.edu';
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}`;

  return createUser({
    email,
    school,
    ...overrides,
  });
}

/**
 * Create an admin user
 * @param {Object} overrides - Properties to override
 * @returns {Object} User object with admin role
 */
function createAdminUser(overrides = {}) {
  return createUser({
    role: 'admin',
    ...overrides,
  });
}

module.exports = {
  createUser,
  createUsers,
  createUserWithCookies,
  createUserWithSession,
  createCookies,
  createUserWithIntegrations,
  createCUBoulderStudent,
  createNonCUStudent,
  createAdminUser,
};
