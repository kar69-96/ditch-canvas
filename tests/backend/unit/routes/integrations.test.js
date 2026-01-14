/**
 * Unit tests for integrations routes
 * Tests OAuth flows, syncing, and integration management
 */

const assert = require('assert');
const request = require('supertest');
const express = require('express');
const { mockSupabase } = require('../../../shared/mocks/supabase');
const userFixtures = require('../../../backend/fixtures/users');
const integrationFixtures = require('../../../backend/fixtures/integrations');
const assignmentFixtures = require('../../../backend/fixtures/assignments');

describe('Integrations Routes', () => {
  let app;

  beforeEach(() => {
    // Reset mocks
    mockSupabase.reset();

    // Create express app
    app = express();
    app.use(express.json());

    // Create test router
    const router = express.Router();

    // Mock GET /api/integrations
    router.get('/', async (req, res) => {
      try {
        const { userEmail } = req.query;

        if (!userEmail) {
          return res.status(400).json({
            success: false,
            error: 'userEmail is required'
          });
        }

        const normalizedEmail = userEmail.toLowerCase().trim();

        const { data: integrations, error } = await mockSupabase
          .from('integrations')
          .select('*')
          .eq('user_email', normalizedEmail);

        if (error) {
          return res.status(500).json({
            success: false,
            error: 'Failed to fetch integrations'
          });
        }

        return res.json({
          success: true,
          data: integrations || []
        });

      } catch (error) {
        return res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    });

    // Mock POST /api/integrations/:provider/connect
    router.post('/:provider/connect', async (req, res) => {
      try {
        const { provider } = req.params;
        const { userEmail } = req.body;

        if (!userEmail) {
          return res.status(400).json({
            success: false,
            error: 'userEmail is required'
          });
        }

        const validProviders = ['google_sheets', 'notion'];
        if (!validProviders.includes(provider)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid provider'
          });
        }

        // Generate mock OAuth URL
        const authUrl = `https://mock-oauth.com/${provider}/authorize?state=${userEmail}`;

        return res.json({
          success: true,
          data: {
            authUrl
          }
        });

      } catch (error) {
        return res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    });

    // Mock GET /api/integrations/:provider/callback
    router.get('/:provider/callback', async (req, res) => {
      try {
        const { provider } = req.params;
        const { code, state } = req.query;

        if (!code || !state) {
          return res.status(400).json({
            success: false,
            error: 'code and state are required'
          });
        }

        const userEmail = state; // In real implementation, state contains user email

        // Mock token exchange
        const mockTokens = {
          access_token: `mock_${provider}_access_token`,
          refresh_token: `mock_${provider}_refresh_token`,
          expiry_date: Date.now() + 3600000
        };

        // Store integration
        const { data: integration, error } = await mockSupabase
          .from('integrations')
          .insert([{
            user_email: userEmail,
            integration_type: provider,
            credentials: mockTokens,
            target_id: `mock_${provider}_target_${Date.now()}`
          }]);

        if (error) {
          return res.status(500).json({
            success: false,
            error: 'Failed to store integration'
          });
        }

        return res.json({
          success: true,
          message: `${provider} connected successfully`,
          data: integration
        });

      } catch (error) {
        return res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    });

    // Mock POST /api/integrations/:provider/sync
    router.post('/:provider/sync', async (req, res) => {
      try {
        const { provider } = req.params;
        const { userEmail } = req.body;

        if (!userEmail) {
          return res.status(400).json({
            success: false,
            error: 'userEmail is required'
          });
        }

        const normalizedEmail = userEmail.toLowerCase().trim();

        // Check if integration exists
        const { data: integrations, error } = await mockSupabase
          .from('integrations')
          .select('*')
          .eq('user_email', normalizedEmail)
          .eq('integration_type', provider)
          .single();

        if (error || !integrations) {
          return res.status(404).json({
            success: false,
            error: 'Integration not found'
          });
        }

        // Mock sync operation
        // In real implementation, this would call Google Sheets or Notion APIs
        const syncResult = {
          provider,
          synced: true,
          itemsUpdated: 5,
          timestamp: new Date().toISOString()
        };

        // Update last_sync_at
        await mockSupabase
          .from('integrations')
          .update({ last_sync_at: new Date().toISOString() })
          .eq('id', integrations.id);

        return res.json({
          success: true,
          message: `Synced to ${provider}`,
          data: syncResult
        });

      } catch (error) {
        return res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    });

    // Mock DELETE /api/integrations/:provider
    router.delete('/:provider', async (req, res) => {
      try {
        const { provider } = req.params;
        const { userEmail } = req.query;

        if (!userEmail) {
          return res.status(400).json({
            success: false,
            error: 'userEmail is required'
          });
        }

        const normalizedEmail = userEmail.toLowerCase().trim();

        // Delete integration
        const { error } = await mockSupabase
          .from('integrations')
          .delete()
          .eq('user_email', normalizedEmail)
          .eq('integration_type', provider);

        if (error) {
          return res.status(500).json({
            success: false,
            error: 'Failed to delete integration'
          });
        }

        // Also delete mappings
        await mockSupabase
          .from('integration_item_mappings')
          .delete()
          .eq('integration_id', `int-${provider}-*`); // Simplified for testing

        return res.json({
          success: true,
          message: `${provider} integration removed`
        });

      } catch (error) {
        return res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    });

    // Mock POST /api/integrations/run-daily-sync
    router.post('/run-daily-sync', async (req, res) => {
      try {
        // Get all active integrations
        const { data: integrations, error } = await mockSupabase
          .from('integrations')
          .select('*');

        if (error) {
          return res.status(500).json({
            success: false,
            error: 'Failed to fetch integrations'
          });
        }

        // Mock sync all integrations
        const results = integrations.map(integration => ({
          userEmail: integration.user_email,
          provider: integration.integration_type,
          status: 'synced',
          itemsUpdated: Math.floor(Math.random() * 10)
        }));

        return res.json({
          success: true,
          message: `Synced ${integrations.length} integrations`,
          data: {
            totalIntegrations: integrations.length,
            results
          }
        });

      } catch (error) {
        return res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    });

    app.use('/api/integrations', router);
  });

  afterEach(() => {
    mockSupabase.reset();
  });

  describe('GET /api/integrations', () => {
    beforeEach(() => {
      mockSupabase.seed('users', [userFixtures.userWithIntegrations]);
      mockSupabase.seed('integrations', userFixtures.userWithIntegrations.integrations);
    });

    it('should return user integrations', async () => {
      const response = await request(app)
        .get('/api/integrations')
        .query({ userEmail: userFixtures.userWithIntegrations.email });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert(Array.isArray(response.body.data));
      assert.strictEqual(response.body.data.length, 2);
    });

    it('should return empty array when user has no integrations', async () => {
      const response = await request(app)
        .get('/api/integrations')
        .query({ userEmail: userFixtures.validUser.email });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.length, 0);
    });

    it('should reject missing userEmail', async () => {
      const response = await request(app)
        .get('/api/integrations');

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.success, false);
      assert(response.body.error.includes('userEmail'));
    });

    it('should normalize email to lowercase', async () => {
      const response = await request(app)
        .get('/api/integrations')
        .query({ userEmail: userFixtures.userWithIntegrations.email.toUpperCase() });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
    });

    it('should include integration credentials and metadata', async () => {
      const response = await request(app)
        .get('/api/integrations')
        .query({ userEmail: userFixtures.userWithIntegrations.email });

      const googleIntegration = response.body.data.find(i => i.integration_type === 'google_sheets');
      assert(googleIntegration);
      assert(googleIntegration.credentials);
      assert(googleIntegration.target_id);
    });
  });

  describe('POST /api/integrations/:provider/connect', () => {
    it('should initiate Google Sheets OAuth flow', async () => {
      const response = await request(app)
        .post('/api/integrations/google_sheets/connect')
        .send({ userEmail: userFixtures.validUser.email });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert(response.body.data.authUrl);
      assert(response.body.data.authUrl.includes('google_sheets'));
    });

    it('should initiate Notion OAuth flow', async () => {
      const response = await request(app)
        .post('/api/integrations/notion/connect')
        .send({ userEmail: userFixtures.validUser.email });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert(response.body.data.authUrl);
      assert(response.body.data.authUrl.includes('notion'));
    });

    it('should reject invalid provider', async () => {
      const response = await request(app)
        .post('/api/integrations/invalid_provider/connect')
        .send({ userEmail: userFixtures.validUser.email });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.success, false);
      assert(response.body.error.includes('Invalid provider'));
    });

    it('should reject missing userEmail', async () => {
      const response = await request(app)
        .post('/api/integrations/google_sheets/connect')
        .send({});

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.success, false);
    });
  });

  describe('GET /api/integrations/:provider/callback', () => {
    it('should handle Google Sheets OAuth callback', async () => {
      const response = await request(app)
        .get('/api/integrations/google_sheets/callback')
        .query({
          code: 'mock_auth_code_123',
          state: userFixtures.validUser.email
        });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert(response.body.message.includes('connected'));
    });

    it('should store integration in database', async () => {
      await request(app)
        .get('/api/integrations/google_sheets/callback')
        .query({
          code: 'mock_auth_code_123',
          state: userFixtures.validUser.email
        });

      // Verify integration was stored
      const integrations = mockSupabase.tables.integrations;
      const stored = integrations.find(i =>
        i.user_email === userFixtures.validUser.email &&
        i.integration_type === 'google_sheets'
      );

      assert(stored);
      assert(stored.credentials);
      assert(stored.credentials.access_token);
      assert(stored.credentials.refresh_token);
    });

    it('should handle Notion OAuth callback', async () => {
      const response = await request(app)
        .get('/api/integrations/notion/callback')
        .query({
          code: 'mock_notion_code_456',
          state: userFixtures.validUser.email
        });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
    });

    it('should reject missing code', async () => {
      const response = await request(app)
        .get('/api/integrations/google_sheets/callback')
        .query({
          state: userFixtures.validUser.email
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.success, false);
    });

    it('should reject missing state', async () => {
      const response = await request(app)
        .get('/api/integrations/google_sheets/callback')
        .query({
          code: 'mock_code'
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.success, false);
    });

    it('should include token expiry date', async () => {
      await request(app)
        .get('/api/integrations/google_sheets/callback')
        .query({
          code: 'mock_code',
          state: userFixtures.validUser.email
        });

      const integrations = mockSupabase.tables.integrations;
      const stored = integrations[0];
      assert(stored.credentials.expiry_date);
      assert(stored.credentials.expiry_date > Date.now());
    });
  });

  describe('POST /api/integrations/:provider/sync', () => {
    beforeEach(() => {
      mockSupabase.seed('users', [userFixtures.validUser]);
      mockSupabase.seed('integrations', [integrationFixtures.googleSheetsIntegration]);
      mockSupabase.seed('extraction_data', assignmentFixtures.allAssignments);
    });

    it('should sync to Google Sheets', async () => {
      const response = await request(app)
        .post('/api/integrations/google_sheets/sync')
        .send({ userEmail: integrationFixtures.googleSheetsIntegration.user_email });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert(response.body.message.includes('Synced'));
      assert(response.body.data.itemsUpdated >= 0);
    });

    it('should update last_sync_at timestamp', async () => {
      const beforeSync = new Date().toISOString();

      await request(app)
        .post('/api/integrations/google_sheets/sync')
        .send({ userEmail: integrationFixtures.googleSheetsIntegration.user_email });

      // Verify last_sync_at was updated
      const integrations = mockSupabase.tables.integrations;
      const updated = integrations.find(i => i.id === integrationFixtures.googleSheetsIntegration.id);

      assert(updated.last_sync_at);
      assert(new Date(updated.last_sync_at) >= new Date(beforeSync));
    });

    it('should sync to Notion', async () => {
      mockSupabase.seed('integrations', [integrationFixtures.notionIntegration]);

      const response = await request(app)
        .post('/api/integrations/notion/sync')
        .send({ userEmail: integrationFixtures.notionIntegration.user_email });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
    });

    it('should return 404 for non-existent integration', async () => {
      const response = await request(app)
        .post('/api/integrations/google_sheets/sync')
        .send({ userEmail: 'nonexistent@colorado.edu' });

      assert.strictEqual(response.status, 404);
      assert.strictEqual(response.body.success, false);
      assert(response.body.error.includes('not found'));
    });

    it('should reject missing userEmail', async () => {
      const response = await request(app)
        .post('/api/integrations/google_sheets/sync')
        .send({});

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.success, false);
    });

    it('should include sync metadata in response', async () => {
      const response = await request(app)
        .post('/api/integrations/google_sheets/sync')
        .send({ userEmail: integrationFixtures.googleSheetsIntegration.user_email });

      assert(response.body.data.provider);
      assert(response.body.data.timestamp);
      assert.strictEqual(response.body.data.synced, true);
    });
  });

  describe('DELETE /api/integrations/:provider', () => {
    beforeEach(() => {
      mockSupabase.seed('integrations', [
        integrationFixtures.googleSheetsIntegration,
        integrationFixtures.notionIntegration
      ]);
      mockSupabase.seed('integration_item_mappings', [
        ...integrationFixtures.googleSheetsMappings,
        ...integrationFixtures.notionMappings
      ]);
    });

    it('should delete Google Sheets integration', async () => {
      const response = await request(app)
        .delete('/api/integrations/google_sheets')
        .query({ userEmail: integrationFixtures.googleSheetsIntegration.user_email });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert(response.body.message.includes('removed'));
    });

    it('should remove integration from database', async () => {
      await request(app)
        .delete('/api/integrations/google_sheets')
        .query({ userEmail: integrationFixtures.googleSheetsIntegration.user_email });

      // Verify integration was deleted
      const integrations = mockSupabase.tables.integrations;
      const exists = integrations.some(i =>
        i.user_email === integrationFixtures.googleSheetsIntegration.user_email &&
        i.integration_type === 'google_sheets'
      );

      assert.strictEqual(exists, false);
    });

    it('should delete Notion integration', async () => {
      const response = await request(app)
        .delete('/api/integrations/notion')
        .query({ userEmail: integrationFixtures.notionIntegration.user_email });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
    });

    it('should handle deletion of non-existent integration', async () => {
      const response = await request(app)
        .delete('/api/integrations/google_sheets')
        .query({ userEmail: 'nonexistent@colorado.edu' });

      // Should succeed even if doesn't exist (idempotent)
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
    });

    it('should reject missing userEmail', async () => {
      const response = await request(app)
        .delete('/api/integrations/google_sheets');

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.success, false);
    });
  });

  describe('POST /api/integrations/run-daily-sync', () => {
    beforeEach(() => {
      mockSupabase.seed('integrations', [
        integrationFixtures.googleSheetsIntegration,
        integrationFixtures.notionIntegration
      ]);
    });

    it('should sync all integrations', async () => {
      const response = await request(app)
        .post('/api/integrations/run-daily-sync')
        .send({});

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.totalIntegrations, 2);
    });

    it('should return sync results for each integration', async () => {
      const response = await request(app)
        .post('/api/integrations/run-daily-sync')
        .send({});

      assert(Array.isArray(response.body.data.results));
      assert.strictEqual(response.body.data.results.length, 2);

      response.body.data.results.forEach(result => {
        assert(result.userEmail);
        assert(result.provider);
        assert(result.status);
      });
    });

    it('should handle empty integrations list', async () => {
      mockSupabase.reset();

      const response = await request(app)
        .post('/api/integrations/run-daily-sync')
        .send({});

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.totalIntegrations, 0);
    });

    it('should report successful sync count', async () => {
      const response = await request(app)
        .post('/api/integrations/run-daily-sync')
        .send({});

      assert(response.body.message.includes('Synced'));
      assert(response.body.message.includes('2'));
    });
  });
});
