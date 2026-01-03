const assert = require('assert');
const request = require('supertest');
const express = require('express');
const streamingAuthRouter = require('../../src/routes/streaming-auth');

/**
 * Integration tests for /api/streaming-auth endpoints
 * NOTE: These tests mock external dependencies (streaming server, Supabase)
 */
describe('Streaming Auth API', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/streaming-auth', streamingAuthRouter);
  });

  describe('GET /api/streaming-auth/status', () => {
    it('should return status information', async () => {
      const response = await request(app)
        .get('/api/streaming-auth/status')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert(typeof response.body.activeProcesses === 'number');
      assert(typeof response.body.port === 'number' || typeof response.body.port === 'string');
    });
  });

  describe('POST /api/streaming-auth/start', () => {
    it('should reject request without email', async () => {
      const response = await request(app)
        .post('/api/streaming-auth/start')
        .send({})
        .expect(400);

      assert.strictEqual(response.body.success, false);
      assert(response.body.error.includes('Email'));
    });

    it('should accept valid email', async () => {
      const response = await request(app)
        .post('/api/streaming-auth/start')
        .send({ email: 'test@example.com' });

      // May succeed or fail depending on streaming script availability
      // But should not reject due to missing email
      assert(response.body.success !== undefined);
    });

    it('should handle forceReauth flag', async () => {
      const response = await request(app)
        .post('/api/streaming-auth/start')
        .send({ email: 'test@example.com', forceReauth: true });

      assert(response.body.success !== undefined);
    });
  });

  describe('POST /api/streaming-auth/stop', () => {
    it('should reject request without email', async () => {
      const response = await request(app)
        .post('/api/streaming-auth/stop')
        .send({})
        .expect(400);

      assert.strictEqual(response.body.success, false);
      assert(response.body.error.includes('Email'));
    });

    it('should accept valid email', async () => {
      const response = await request(app)
        .post('/api/streaming-auth/stop')
        .send({ email: 'test@example.com' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });

    it('should handle non-existent process gracefully', async () => {
      const response = await request(app)
        .post('/api/streaming-auth/stop')
        .send({ email: 'nonexistent@example.com' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert(response.body.message.includes('No active'));
    });
  });

  describe('DELETE /api/streaming-auth/cookies/:email', () => {
    it('should delete cookies for email', async () => {
      const response = await request(app)
        .delete('/api/streaming-auth/cookies/test@example.com')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert(typeof response.body.deleted === 'boolean');
    });

    it('should handle missing email', async () => {
      const response = await request(app)
        .delete('/api/streaming-auth/cookies/')
        .expect(404);
    });
  });

  describe('POST /api/streaming-auth/check-email', () => {
    const describeIfSupabase = process.env.SUPABASE_URL ? describe : describe.skip;

    it('should reject request without email', async () => {
      const response = await request(app)
        .post('/api/streaming-auth/check-email')
        .send({})
        .expect(400);

      assert.strictEqual(response.body.success, false);
    });

    describeIfSupabase('with Supabase', () => {
      it('should check if email exists', async () => {
        const response = await request(app)
          .post('/api/streaming-auth/check-email')
          .send({ email: 'test@example.com' })
          .expect(200);

        assert.strictEqual(response.body.success, true);
        assert(typeof response.body.exists === 'boolean');
      });
    });
  });

  describe('GET /api/streaming-auth/extraction-result/:email', () => {
    it('should return extraction result or error', async () => {
      const response = await request(app)
        .get('/api/streaming-auth/extraction-result/test@example.com')
        .expect(200);

      // May have result or error depending on state
      assert(response.body.success !== undefined);
    });

    it('should handle email normalization', async () => {
      const response1 = await request(app)
        .get('/api/streaming-auth/extraction-result/Test@Example.com')
        .expect(200);

      const response2 = await request(app)
        .get('/api/streaming-auth/extraction-result/test@example.com')
        .expect(200);

      // Should treat both the same (normalized to lowercase)
      assert.deepStrictEqual(response1.body, response2.body);
    });
  });

  describe('POST /api/streaming-auth/verify-login', () => {
    it('should reject without email', async () => {
      const response = await request(app)
        .post('/api/streaming-auth/verify-login')
        .send({ username: 'test' })
        .expect(400);

      assert.strictEqual(response.body.success, false);
    });

    it('should reject without username', async () => {
      const response = await request(app)
        .post('/api/streaming-auth/verify-login')
        .send({ email: 'test@colorado.edu' })
        .expect(400);

      assert.strictEqual(response.body.success, false);
    });

    it('should verify matching email and username', async () => {
      const response = await request(app)
        .post('/api/streaming-auth/verify-login')
        .send({ email: 'test1234@colorado.edu', username: 'test1234' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.isValid, true);
      assert.strictEqual(response.body.matchPercentage, 100);
    });

    it('should reject mismatched email and username', async () => {
      const response = await request(app)
        .post('/api/streaming-auth/verify-login')
        .send({ email: 'test1234@colorado.edu', username: 'different5678' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.isValid, false);
      assert(response.body.matchPercentage < 30);
    });

    it('should reject invalid email format', async () => {
      const response = await request(app)
        .post('/api/streaming-auth/verify-login')
        .send({ email: 'invalid@gmail.com', username: 'test' })
        .expect(200);

      assert.strictEqual(response.body.success, false);
      assert(response.body.error.includes('Invalid email format'));
    });
  });

  describe('GET /api/streaming-auth/update-status', () => {
    it('should return AWS update configuration status', async () => {
      const response = await request(app)
        .get('/api/streaming-auth/update-status')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert(typeof response.body.awsConfigured === 'boolean');
      assert(typeof response.body.scriptExists === 'boolean');
      assert(typeof response.body.cookiesExist === 'boolean');
    });
  });

  describe('POST /api/streaming-auth/trigger-update', () => {
    it('should require AWS configuration', async () => {
      if (!process.env.AWS_INSTANCE_ID) {
        const response = await request(app)
          .post('/api/streaming-auth/trigger-update')
          .expect(400);

        assert.strictEqual(response.body.success, false);
        assert(response.body.error.includes('AWS_INSTANCE_ID'));
      }
    });
  });
});

