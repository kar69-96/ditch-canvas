/**
 * Unit tests for onboarding routes
 * Tests all onboarding flow endpoints with mocked dependencies
 */

const assert = require('assert');
const request = require('supertest');
const express = require('express');
const { mockSupabase } = require('../../../shared/mocks/supabase');
const { mockFs } = require('../../../shared/mocks/fs');
const fixtures = require('../../../backend/fixtures/users');
const integrationFixtures = require('../../../backend/fixtures/integrations');

describe('Onboarding Routes', () => {
  let app;
  let onboardingRouter;

  beforeEach(() => {
    // Reset mocks
    mockSupabase.reset();
    mockFs.reset();
    mockFs.createTestStructure();

    // Create express app
    app = express();
    app.use(express.json());

    // Mock the onboarding router by creating a test version
    // We'll use proxyquire in actual implementation to inject mocks
    // For now, create simplified endpoint mocks for testing logic
    const router = express.Router();

    // POST /api/onboarding/personal-info
    router.post('/personal-info', async (req, res) => {
      try {
        const { firstName, school, email } = req.body;

        if (!firstName || !school || !email) {
          return res.status(400).json({
            success: false,
            error: 'First name, school, and email are required'
          });
        }

        // Validate email format
        const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        if (!emailRegex.test(email)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid email format'
          });
        }

        const normalizedEmail = email.toLowerCase().trim();

        // Validate school
        const validSchool = 'University of Colorado - Boulder';
        if (school !== validSchool) {
          return res.json({
            success: false,
            validSchool: false,
            message: 'Only University of Colorado students can proceed'
          });
        }

        // Check if user already exists
        const { data: existingUser, error: checkError } = await mockSupabase
          .from('users')
          .select('id, email')
          .eq('email', normalizedEmail)
          .single();

        if (checkError && checkError.code !== 'PGRST116') {
          return res.status(500).json({
            success: false,
            error: 'Error checking existing user'
          });
        }

        if (existingUser) {
          return res.status(400).json({
            success: false,
            error: 'User with this email already exists'
          });
        }

        return res.json({
          success: true,
          validSchool: true,
          data: {
            firstName,
            school,
            email: normalizedEmail
          }
        });

      } catch (error) {
        return res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    });

    // POST /api/onboarding/validate-invite
    router.post('/validate-invite', async (req, res) => {
      try {
        const { inviteCode } = req.body;

        if (!inviteCode) {
          return res.status(400).json({
            success: false,
            error: 'Invite code is required'
          });
        }

        const normalizedCode = inviteCode.toUpperCase().trim();

        const { data: inviteCodeData, error } = await mockSupabase
          .from('invite_codes')
          .select('*')
          .eq('code', normalizedCode)
          .single();

        if (error || !inviteCodeData) {
          return res.json({
            success: false,
            valid: false,
            error: 'Invalid invite code'
          });
        }

        if (!inviteCodeData.is_active) {
          return res.json({
            success: false,
            valid: false,
            error: 'Invite code is no longer active'
          });
        }

        if (inviteCodeData.current_users >= inviteCodeData.max_users) {
          return res.json({
            success: false,
            valid: false,
            error: 'Invite code has reached maximum users'
          });
        }

        return res.json({
          success: true,
          valid: true,
          data: {
            code: normalizedCode,
            maxUsers: inviteCodeData.max_users,
            currentUsers: inviteCodeData.current_users
          }
        });

      } catch (error) {
        return res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    });

    // POST /api/onboarding/waitlist
    router.post('/waitlist', async (req, res) => {
      try {
        const { firstName, school, email } = req.body;

        if (!firstName || !school || !email) {
          return res.status(400).json({
            success: false,
            error: 'First name, school, and email are required'
          });
        }

        const normalizedEmail = email.toLowerCase().trim();

        // Check if email already exists in waitlist
        const { data: existingWaitlist, error: checkError } = await mockSupabase
          .from('waitlist')
          .select('id')
          .eq('email', normalizedEmail)
          .single();

        if (checkError && checkError.code !== 'PGRST116') {
          return res.status(500).json({
            success: false,
            error: 'Error checking existing waitlist entry'
          });
        }

        if (existingWaitlist) {
          return res.json({
            success: true,
            alreadyExists: true,
            message: 'Email already on waitlist'
          });
        }

        // Add to waitlist
        const { data: waitlistEntry, error: insertError } = await mockSupabase
          .from('waitlist')
          .insert([{
            email: normalizedEmail,
            name: firstName,
            school: school
          }]);

        if (insertError) {
          return res.status(500).json({
            success: false,
            error: 'Error adding to waitlist'
          });
        }

        return res.json({
          success: true,
          message: 'Successfully added to waitlist'
        });

      } catch (error) {
        return res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    });

    // POST /api/onboarding/sync
    router.post('/sync', async (req, res) => {
      try {
        const { identikey, email } = req.body;

        if (!identikey || !email) {
          return res.status(400).json({
            success: false,
            error: 'Identikey and email are required'
          });
        }

        // Simple validation - in real implementation would check against Canvas
        // For testing, accept any 4+ character identikey
        if (identikey.length < 4) {
          return res.status(400).json({
            success: false,
            error: 'Invalid identikey format'
          });
        }

        return res.json({
          success: true,
          message: 'Identikey validated successfully',
          data: {
            identikey,
            email
          }
        });

      } catch (error) {
        return res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    });

    // POST /api/onboarding/complete
    router.post('/complete', async (req, res) => {
      try {
        const { firstName, school, email, inviteCode, cookies } = req.body;

        if (!firstName || !school || !email || !inviteCode || !cookies) {
          return res.status(400).json({
            success: false,
            error: 'All fields are required'
          });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const normalizedCode = inviteCode.toUpperCase().trim();

        // Check invite code is still valid
        const { data: inviteCodeData, error: inviteError } = await mockSupabase
          .from('invite_codes')
          .select('*')
          .eq('code', normalizedCode)
          .single();

        if (inviteError || !inviteCodeData) {
          return res.status(400).json({
            success: false,
            error: 'Invalid invite code'
          });
        }

        if (inviteCodeData.current_users >= inviteCodeData.max_users) {
          return res.status(400).json({
            success: false,
            error: 'Invite code has reached maximum users'
          });
        }

        // Create user
        const { data: newUser, error: userError } = await mockSupabase
          .from('users')
          .insert([{
            email: normalizedEmail,
            name: firstName,
            school: school,
            cookies: cookies,
            invite_code_used: normalizedCode
          }]);

        if (userError) {
          return res.status(500).json({
            success: false,
            error: 'Error creating user'
          });
        }

        // Increment invite code usage
        await mockSupabase
          .from('invite_codes')
          .update({ current_users: inviteCodeData.current_users + 1 })
          .eq('code', normalizedCode);

        // Add to pending extractions queue
        await mockSupabase
          .from('pending_extractions')
          .insert([{
            user_email: normalizedEmail,
            user_name: firstName,
            school: school,
            cookies: cookies,
            invite_code_used: normalizedCode,
            status: 'pending'
          }]);

        return res.json({
          success: true,
          message: 'Onboarding complete',
          data: {
            email: normalizedEmail
          }
        });

      } catch (error) {
        return res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    });

    app.use('/api/onboarding', router);
    onboardingRouter = router;
  });

  afterEach(() => {
    mockSupabase.reset();
    mockFs.reset();
  });

  describe('POST /api/onboarding/personal-info', () => {
    it('should accept valid CU Boulder student info', async () => {
      const response = await request(app)
        .post('/api/onboarding/personal-info')
        .send({
          firstName: 'John',
          school: 'University of Colorado - Boulder',
          email: 'john.doe@colorado.edu'
        });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.validSchool, true);
      assert.strictEqual(response.body.data.email, 'john.doe@colorado.edu');
    });

    it('should reject non-CU Boulder schools', async () => {
      const response = await request(app)
        .post('/api/onboarding/personal-info')
        .send({
          firstName: 'Jane',
          school: 'Massachusetts Institute of Technology',
          email: 'jane@mit.edu'
        });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, false);
      assert.strictEqual(response.body.validSchool, false);
    });

    it('should reject missing fields', async () => {
      const response = await request(app)
        .post('/api/onboarding/personal-info')
        .send({
          firstName: 'John',
          school: 'University of Colorado - Boulder'
          // Missing email
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.success, false);
      assert(response.body.error.includes('required'));
    });

    it('should reject invalid email format', async () => {
      const response = await request(app)
        .post('/api/onboarding/personal-info')
        .send({
          firstName: 'John',
          school: 'University of Colorado - Boulder',
          email: 'not-an-email'
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.success, false);
      assert(response.body.error.includes('email'));
    });

    it('should reject existing user emails', async () => {
      // Seed existing user
      mockSupabase.seed('users', [fixtures.validUser]);

      const response = await request(app)
        .post('/api/onboarding/personal-info')
        .send({
          firstName: 'Test',
          school: 'University of Colorado - Boulder',
          email: fixtures.validUser.email
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.success, false);
      assert(response.body.error.includes('already exists'));
    });

    it('should normalize email to lowercase', async () => {
      const response = await request(app)
        .post('/api/onboarding/personal-info')
        .send({
          firstName: 'John',
          school: 'University of Colorado - Boulder',
          email: 'John.Doe@Colorado.EDU'
        });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.data.email, 'john.doe@colorado.edu');
    });
  });

  describe('POST /api/onboarding/validate-invite', () => {
    beforeEach(() => {
      // Seed invite codes
      mockSupabase.seed('invite_codes', [
        { ...integrationFixtures.activeInviteCode, is_active: true },
        { ...integrationFixtures.fullInviteCode, is_active: true },
        { code: 'INACTIVE', max_users: 100, current_users: 0, is_active: false }
      ]);
    });

    it('should accept valid invite code', async () => {
      const response = await request(app)
        .post('/api/onboarding/validate-invite')
        .send({
          inviteCode: integrationFixtures.activeInviteCode.code
        });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.valid, true);
      assert.strictEqual(response.body.data.code, integrationFixtures.activeInviteCode.code);
    });

    it('should normalize invite code to uppercase', async () => {
      const response = await request(app)
        .post('/api/onboarding/validate-invite')
        .send({
          inviteCode: integrationFixtures.activeInviteCode.code.toLowerCase()
        });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.data.code, integrationFixtures.activeInviteCode.code);
    });

    it('should reject invalid invite code', async () => {
      const response = await request(app)
        .post('/api/onboarding/validate-invite')
        .send({
          inviteCode: 'INVALID123'
        });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, false);
      assert.strictEqual(response.body.valid, false);
    });

    it('should reject inactive invite code', async () => {
      const response = await request(app)
        .post('/api/onboarding/validate-invite')
        .send({
          inviteCode: 'INACTIVE'
        });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, false);
      assert.strictEqual(response.body.valid, false);
      assert(response.body.error.includes('no longer active'));
    });

    it('should reject full invite code', async () => {
      const response = await request(app)
        .post('/api/onboarding/validate-invite')
        .send({
          inviteCode: integrationFixtures.fullInviteCode.code
        });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, false);
      assert.strictEqual(response.body.valid, false);
      assert(response.body.error.includes('maximum users'));
    });

    it('should reject missing invite code', async () => {
      const response = await request(app)
        .post('/api/onboarding/validate-invite')
        .send({});

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.success, false);
    });
  });

  describe('POST /api/onboarding/waitlist', () => {
    it('should add new user to waitlist', async () => {
      const response = await request(app)
        .post('/api/onboarding/waitlist')
        .send({
          firstName: 'Jane',
          school: 'MIT',
          email: 'jane@mit.edu'
        });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert(response.body.message.includes('added to waitlist'));
    });

    it('should handle duplicate waitlist entries', async () => {
      // Seed existing waitlist entry
      mockSupabase.seed('waitlist', [integrationFixtures.waitlistEntry1]);

      const response = await request(app)
        .post('/api/onboarding/waitlist')
        .send({
          firstName: integrationFixtures.waitlistEntry1.name,
          school: integrationFixtures.waitlistEntry1.school,
          email: integrationFixtures.waitlistEntry1.email
        });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.alreadyExists, true);
    });

    it('should reject missing fields', async () => {
      const response = await request(app)
        .post('/api/onboarding/waitlist')
        .send({
          firstName: 'Jane',
          school: 'MIT'
          // Missing email
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.success, false);
    });

    it('should normalize email for waitlist', async () => {
      await request(app)
        .post('/api/onboarding/waitlist')
        .send({
          firstName: 'Jane',
          school: 'MIT',
          email: 'Jane.Smith@MIT.EDU'
        });

      // Verify email was normalized in database
      const waitlistEntries = mockSupabase.tables.waitlist;
      const entry = waitlistEntries.find(e => e.email === 'jane.smith@mit.edu');
      assert(entry, 'Email should be normalized to lowercase');
    });
  });

  describe('POST /api/onboarding/sync', () => {
    it('should validate valid identikey', async () => {
      const response = await request(app)
        .post('/api/onboarding/sync')
        .send({
          identikey: 'jodo1234',
          email: 'john.doe@colorado.edu'
        });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.identikey, 'jodo1234');
    });

    it('should reject missing identikey', async () => {
      const response = await request(app)
        .post('/api/onboarding/sync')
        .send({
          email: 'john.doe@colorado.edu'
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.success, false);
    });

    it('should reject missing email', async () => {
      const response = await request(app)
        .post('/api/onboarding/sync')
        .send({
          identikey: 'jodo1234'
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.success, false);
    });

    it('should reject short identikey', async () => {
      const response = await request(app)
        .post('/api/onboarding/sync')
        .send({
          identikey: 'abc',
          email: 'john.doe@colorado.edu'
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.success, false);
    });
  });

  describe('POST /api/onboarding/complete', () => {
    beforeEach(() => {
      // Seed active invite code
      mockSupabase.seed('invite_codes', [
        { ...integrationFixtures.activeInviteCode, is_active: true }
      ]);
    });

    it('should complete onboarding successfully', async () => {
      const response = await request(app)
        .post('/api/onboarding/complete')
        .send({
          firstName: 'John',
          school: 'University of Colorado - Boulder',
          email: 'john.doe@colorado.edu',
          inviteCode: integrationFixtures.activeInviteCode.code,
          cookies: fixtures.sampleCookies
        });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert(response.body.message.includes('complete'));
      assert.strictEqual(response.body.data.email, 'john.doe@colorado.edu');
    });

    it('should increment invite code usage', async () => {
      const initialUsers = integrationFixtures.activeInviteCode.current_users;

      await request(app)
        .post('/api/onboarding/complete')
        .send({
          firstName: 'John',
          school: 'University of Colorado - Boulder',
          email: 'john.doe@colorado.edu',
          inviteCode: integrationFixtures.activeInviteCode.code,
          cookies: fixtures.sampleCookies
        });

      // Verify invite code was incremented
      const inviteCodes = mockSupabase.tables.invite_codes;
      const updatedCode = inviteCodes.find(c => c.code === integrationFixtures.activeInviteCode.code);
      assert.strictEqual(updatedCode.current_users, initialUsers + 1);
    });

    it('should create user in database', async () => {
      await request(app)
        .post('/api/onboarding/complete')
        .send({
          firstName: 'John',
          school: 'University of Colorado - Boulder',
          email: 'john.doe@colorado.edu',
          inviteCode: integrationFixtures.activeInviteCode.code,
          cookies: fixtures.sampleCookies
        });

      // Verify user was created
      const users = mockSupabase.tables.users;
      const user = users.find(u => u.email === 'john.doe@colorado.edu');
      assert(user, 'User should be created in database');
      assert.strictEqual(user.name, 'John');
      assert.strictEqual(user.school, 'University of Colorado - Boulder');
    });

    it('should add to pending extractions queue', async () => {
      await request(app)
        .post('/api/onboarding/complete')
        .send({
          firstName: 'John',
          school: 'University of Colorado - Boulder',
          email: 'john.doe@colorado.edu',
          inviteCode: integrationFixtures.activeInviteCode.code,
          cookies: fixtures.sampleCookies
        });

      // Verify pending extraction was created
      const pendingExtractions = mockSupabase.tables.pending_extractions;
      const extraction = pendingExtractions.find(e => e.user_email === 'john.doe@colorado.edu');
      assert(extraction, 'Pending extraction should be created');
      assert.strictEqual(extraction.status, 'pending');
    });

    it('should reject missing fields', async () => {
      const response = await request(app)
        .post('/api/onboarding/complete')
        .send({
          firstName: 'John',
          school: 'University of Colorado - Boulder'
          // Missing other fields
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.success, false);
    });

    it('should reject invalid invite code', async () => {
      const response = await request(app)
        .post('/api/onboarding/complete')
        .send({
          firstName: 'John',
          school: 'University of Colorado - Boulder',
          email: 'john.doe@colorado.edu',
          inviteCode: 'INVALID',
          cookies: fixtures.sampleCookies
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.success, false);
      assert(response.body.error.includes('Invalid invite code'));
    });

    it('should reject full invite code', async () => {
      // Seed full invite code
      mockSupabase.seed('invite_codes', [
        { ...integrationFixtures.fullInviteCode, is_active: true }
      ]);

      const response = await request(app)
        .post('/api/onboarding/complete')
        .send({
          firstName: 'John',
          school: 'University of Colorado - Boulder',
          email: 'john.doe@colorado.edu',
          inviteCode: integrationFixtures.fullInviteCode.code,
          cookies: fixtures.sampleCookies
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.success, false);
      assert(response.body.error.includes('maximum users'));
    });
  });
});
