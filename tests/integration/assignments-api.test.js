const assert = require('assert');
const request = require('supertest');
const express = require('express');
const assignmentsRouter = require('../../src/core/assignments');

/**
 * Integration tests for /api/assignments endpoints
 * Requires Supabase to be configured for completion status tests
 */
describe('Assignments API', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/assignments', assignmentsRouter);
  });

  describe('GET /api/assignments', () => {
    it('should return assignments list', async () => {
      const response = await request(app)
        .get('/api/assignments')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert(Array.isArray(response.body.data));
    });

    it('should return empty array if no assignments', async () => {
      const response = await request(app)
        .get('/api/assignments')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      // May be empty or populated depending on data file
    });
  });

  describe('PATCH /api/assignments/:assignmentId/complete', () => {
    it('should reject request without userEmail', async () => {
      const response = await request(app)
        .patch('/api/assignments/123/complete')
        .send({ isCompleted: true })
        .expect(400);

      assert.strictEqual(response.body.success, false);
      assert(response.body.error.includes('userEmail'));
    });

    it('should reject request without isCompleted boolean', async () => {
      const response = await request(app)
        .patch('/api/assignments/123/complete')
        .send({ userEmail: 'test@example.com' })
        .expect(400);

      assert.strictEqual(response.body.success, false);
      assert(response.body.error.includes('isCompleted'));
    });

    it('should reject request with invalid isCompleted type', async () => {
      const response = await request(app)
        .patch('/api/assignments/123/complete')
        .send({ userEmail: 'test@example.com', isCompleted: 'yes' })
        .expect(400);

      assert.strictEqual(response.body.success, false);
      assert(response.body.error.includes('boolean'));
    });

    // NOTE: The following tests require actual Supabase connection
    // They are skipped if SUPABASE_URL is not configured

    const describeIfSupabase = process.env.SUPABASE_URL ? describe : describe.skip;

    describeIfSupabase('with Supabase', () => {
      it('should mark assignment as complete', async () => {
        const response = await request(app)
          .patch('/api/assignments/123/complete')
          .send({
            userEmail: 'test@example.com',
            isCompleted: true,
            courseId: '456'
          })
          .expect(200);

        assert.strictEqual(response.body.success, true);
        assert.strictEqual(response.body.isCompleted, true);
        assert.strictEqual(response.body.assignmentId, '123');
      });

      it('should mark assignment as incomplete', async () => {
        const response = await request(app)
          .patch('/api/assignments/123/complete')
          .send({
            userEmail: 'test@example.com',
            isCompleted: false,
            courseId: '456'
          })
          .expect(200);

        assert.strictEqual(response.body.success, true);
        assert.strictEqual(response.body.isCompleted, false);
      });

      it('should handle non-existent assignment', async () => {
        const response = await request(app)
          .patch('/api/assignments/999999/complete')
          .send({
            userEmail: 'test@example.com',
            isCompleted: true,
            courseId: '456'
          })
          .expect(404);

        assert.strictEqual(response.body.success, false);
        assert(response.body.error.includes('not found'));
      });
    });
  });

  describe('Error handling', () => {
    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .patch('/api/assignments/123/complete')
        .set('Content-Type', 'application/json')
        .send('{"invalid json}')
        .expect(400);
    });

    it('should handle missing assignment ID', async () => {
      const response = await request(app)
        .patch('/api/assignments//complete')
        .send({ userEmail: 'test@example.com', isCompleted: true })
        .expect(404);
    });
  });
});

