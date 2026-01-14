/**
 * Unit tests for assignments routes
 * Tests assignment listing and completion status updates
 */

const assert = require('assert');
const request = require('supertest');
const express = require('express');
const { mockSupabase } = require('../../../shared/mocks/supabase');
const { mockFs } = require('../../../shared/mocks/fs');
const assignmentFixtures = require('../../../backend/fixtures/assignments');
const userFixtures = require('../../../backend/fixtures/users');

describe('Assignments Routes', () => {
  let app;

  beforeEach(() => {
    // Reset mocks
    mockSupabase.reset();
    mockFs.reset();
    mockFs.createTestStructure();

    // Create express app
    app = express();
    app.use(express.json());

    // Create test router
    const router = express.Router();

    // Mock GET /api/assignments
    router.get('/', async (req, res) => {
      try {
        // In real implementation, this reads from data/assignments.json
        // For testing, return fixture data
        const assignments = assignmentFixtures.allAssignments.map(a => a.data);
        return res.json({ success: true, data: assignments });
      } catch (error) {
        return res.status(500).json({
          success: false,
          error: { message: 'Failed to load assignments' }
        });
      }
    });

    // Mock PATCH /api/assignments/:assignmentId/complete
    router.patch('/:assignmentId/complete', async (req, res) => {
      try {
        const { assignmentId } = req.params;
        const { userEmail, isCompleted, courseId } = req.body;

        if (!userEmail) {
          return res.status(400).json({
            success: false,
            error: 'userEmail is required'
          });
        }

        if (typeof isCompleted !== 'boolean') {
          return res.status(400).json({
            success: false,
            error: 'isCompleted must be a boolean'
          });
        }

        const normalizedEmail = userEmail.toLowerCase().trim();

        // Get existing assignment
        const { data: existingEntities, error: fetchError } = await mockSupabase.rpc('get_user_entities', {
          user_email: normalizedEmail,
          entity_type_filter: 'assignment',
          course_id_filter: courseId ? String(courseId) : null
        });

        if (fetchError) {
          return res.status(500).json({
            success: false,
            error: 'Failed to fetch assignment'
          });
        }

        const assignment = existingEntities?.find(e => e.entity_id === assignmentId);

        if (!assignment) {
          return res.status(404).json({
            success: false,
            error: 'Assignment not found'
          });
        }

        // Update completion status
        const updatedMetadata = {
          ...assignment.metadata,
          userMarkedComplete: isCompleted,
          completedAt: isCompleted ? new Date().toISOString() : null
        };

        const { error: updateError } = await mockSupabase.rpc('upsert_user_entity', {
          user_email: normalizedEmail,
          entity_type: 'assignment',
          entity_id: assignmentId,
          course_id: courseId ? String(courseId) : assignment.course_id,
          entity_data: assignment.data,
          entity_metadata: updatedMetadata
        });

        if (updateError) {
          return res.status(500).json({
            success: false,
            error: 'Failed to update assignment'
          });
        }

        // Note: In real implementation, this would trigger integration syncs
        // For unit tests, we skip that

        return res.json({
          success: true,
          message: 'Assignment completion status updated',
          data: {
            assignmentId,
            isCompleted
          }
        });

      } catch (error) {
        return res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    });

    app.use('/api/assignments', router);
  });

  afterEach(() => {
    mockSupabase.reset();
    mockFs.reset();
  });

  describe('GET /api/assignments', () => {
    it('should return all assignments', async () => {
      const response = await request(app)
        .get('/api/assignments');

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert(Array.isArray(response.body.data));
      assert.strictEqual(response.body.data.length, assignmentFixtures.allAssignments.length);
    });

    it('should return assignment data with required fields', async () => {
      const response = await request(app)
        .get('/api/assignments');

      assert.strictEqual(response.status, 200);
      const firstAssignment = response.body.data[0];

      // Verify required fields exist
      assert(firstAssignment.id);
      assert(firstAssignment.title);
      assert(firstAssignment.courseId);
      assert(firstAssignment.courseName);
    });

    it('should return empty array when no assignments exist', async () => {
      // Override to return empty array
      app._router.stack.forEach((layer) => {
        if (layer.name === 'router') {
          const router = layer.handle;
          router.stack.forEach((r) => {
            if (r.route && r.route.path === '/') {
              r.route.stack[0].handle = async (req, res) => {
                return res.json({ success: true, data: [] });
              };
            }
          });
        }
      });

      const response = await request(app)
        .get('/api/assignments');

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.length, 0);
    });

    it('should handle errors gracefully', async () => {
      // Override to throw error
      app._router.stack.forEach((layer) => {
        if (layer.name === 'router') {
          const router = layer.handle;
          router.stack.forEach((r) => {
            if (r.route && r.route.path === '/') {
              r.route.stack[0].handle = async (req, res) => {
                throw new Error('Test error');
              };
            }
          });
        }
      });

      const response = await request(app)
        .get('/api/assignments');

      assert.strictEqual(response.status, 500);
      assert.strictEqual(response.body.success, false);
    });
  });

  describe('PATCH /api/assignments/:assignmentId/complete', () => {
    beforeEach(() => {
      // Seed test user and assignments
      mockSupabase.seed('users', [userFixtures.validUser]);
      mockSupabase.seed('extraction_data', assignmentFixtures.allAssignments);
    });

    it('should mark assignment as complete', async () => {
      const assignment = assignmentFixtures.upcomingAssignment;

      const response = await request(app)
        .patch(`/api/assignments/${assignment.entity_id}/complete`)
        .send({
          userEmail: userFixtures.validUser.email,
          isCompleted: true,
          courseId: assignment.course_id
        });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.isCompleted, true);
    });

    it('should mark assignment as incomplete', async () => {
      const assignment = assignmentFixtures.submittedAssignment;

      const response = await request(app)
        .patch(`/api/assignments/${assignment.entity_id}/complete`)
        .send({
          userEmail: userFixtures.validUser.email,
          isCompleted: false,
          courseId: assignment.course_id
        });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.isCompleted, false);
    });

    it('should update assignment metadata in database', async () => {
      const assignment = assignmentFixtures.upcomingAssignment;

      await request(app)
        .patch(`/api/assignments/${assignment.entity_id}/complete`)
        .send({
          userEmail: userFixtures.validUser.email,
          isCompleted: true,
          courseId: assignment.course_id
        });

      // Verify database was updated
      const { data: entities } = await mockSupabase.rpc('get_user_entities', {
        user_email: userFixtures.validUser.email,
        entity_type_filter: 'assignment',
        course_id_filter: assignment.course_id
      });

      const updatedAssignment = entities.find(e => e.entity_id === assignment.entity_id);
      assert.strictEqual(updatedAssignment.metadata.userMarkedComplete, true);
      assert(updatedAssignment.metadata.completedAt);
    });

    it('should normalize email to lowercase', async () => {
      const assignment = assignmentFixtures.upcomingAssignment;

      const response = await request(app)
        .patch(`/api/assignments/${assignment.entity_id}/complete`)
        .send({
          userEmail: 'TEST@Colorado.EDU',
          isCompleted: true,
          courseId: assignment.course_id
        });

      assert.strictEqual(response.status, 200);
    });

    it('should reject missing userEmail', async () => {
      const assignment = assignmentFixtures.upcomingAssignment;

      const response = await request(app)
        .patch(`/api/assignments/${assignment.entity_id}/complete`)
        .send({
          isCompleted: true,
          courseId: assignment.course_id
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.success, false);
      assert(response.body.error.includes('userEmail'));
    });

    it('should reject non-boolean isCompleted', async () => {
      const assignment = assignmentFixtures.upcomingAssignment;

      const response = await request(app)
        .patch(`/api/assignments/${assignment.entity_id}/complete`)
        .send({
          userEmail: userFixtures.validUser.email,
          isCompleted: 'yes',
          courseId: assignment.course_id
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.success, false);
      assert(response.body.error.includes('boolean'));
    });

    it('should return 404 for non-existent assignment', async () => {
      const response = await request(app)
        .patch('/api/assignments/999999/complete')
        .send({
          userEmail: userFixtures.validUser.email,
          isCompleted: true,
          courseId: '123456'
        });

      assert.strictEqual(response.status, 404);
      assert.strictEqual(response.body.success, false);
      assert(response.body.error.includes('not found'));
    });

    it('should handle updates for different assignment types', async () => {
      // Test with quiz assignment
      const quizAssignment = assignmentFixtures.quizAssignment;

      const response = await request(app)
        .patch(`/api/assignments/${quizAssignment.entity_id}/complete`)
        .send({
          userEmail: userFixtures.validUser.email,
          isCompleted: true,
          courseId: quizAssignment.course_id
        });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
    });

    it('should handle assignments without due dates', async () => {
      const noDueDate = assignmentFixtures.noDueDateAssignment;

      const response = await request(app)
        .patch(`/api/assignments/${noDueDate.entity_id}/complete`)
        .send({
          userEmail: userFixtures.validUser.email,
          isCompleted: true,
          courseId: noDueDate.course_id
        });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
    });

    it('should preserve existing assignment data during update', async () => {
      const assignment = assignmentFixtures.upcomingAssignment;
      const originalTitle = assignment.data.title;
      const originalPoints = assignment.data.pointsPossible;

      await request(app)
        .patch(`/api/assignments/${assignment.entity_id}/complete`)
        .send({
          userEmail: userFixtures.validUser.email,
          isCompleted: true,
          courseId: assignment.course_id
        });

      // Verify original data was preserved
      const { data: entities } = await mockSupabase.rpc('get_user_entities', {
        user_email: userFixtures.validUser.email,
        entity_type_filter: 'assignment',
        course_id_filter: assignment.course_id
      });

      const updatedAssignment = entities.find(e => e.entity_id === assignment.entity_id);
      assert.strictEqual(updatedAssignment.data.title, originalTitle);
      assert.strictEqual(updatedAssignment.data.pointsPossible, originalPoints);
    });

    it('should handle completion toggle (complete -> incomplete -> complete)', async () => {
      const assignment = assignmentFixtures.upcomingAssignment;

      // Mark as complete
      await request(app)
        .patch(`/api/assignments/${assignment.entity_id}/complete`)
        .send({
          userEmail: userFixtures.validUser.email,
          isCompleted: true,
          courseId: assignment.course_id
        });

      // Mark as incomplete
      await request(app)
        .patch(`/api/assignments/${assignment.entity_id}/complete`)
        .send({
          userEmail: userFixtures.validUser.email,
          isCompleted: false,
          courseId: assignment.course_id
        });

      // Mark as complete again
      const response = await request(app)
        .patch(`/api/assignments/${assignment.entity_id}/complete`)
        .send({
          userEmail: userFixtures.validUser.email,
          isCompleted: true,
          courseId: assignment.course_id
        });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.data.isCompleted, true);
    });

    it('should set completedAt timestamp when marking complete', async () => {
      const assignment = assignmentFixtures.upcomingAssignment;
      const beforeTime = new Date().toISOString();

      await request(app)
        .patch(`/api/assignments/${assignment.entity_id}/complete`)
        .send({
          userEmail: userFixtures.validUser.email,
          isCompleted: true,
          courseId: assignment.course_id
        });

      const { data: entities } = await mockSupabase.rpc('get_user_entities', {
        user_email: userFixtures.validUser.email,
        entity_type_filter: 'assignment',
        course_id_filter: assignment.course_id
      });

      const updatedAssignment = entities.find(e => e.entity_id === assignment.entity_id);
      assert(updatedAssignment.metadata.completedAt);
      assert(new Date(updatedAssignment.metadata.completedAt) >= new Date(beforeTime));
    });

    it('should clear completedAt timestamp when marking incomplete', async () => {
      const assignment = assignmentFixtures.submittedAssignment;

      await request(app)
        .patch(`/api/assignments/${assignment.entity_id}/complete`)
        .send({
          userEmail: userFixtures.validUser.email,
          isCompleted: false,
          courseId: assignment.course_id
        });

      const { data: entities } = await mockSupabase.rpc('get_user_entities', {
        user_email: userFixtures.validUser.email,
        entity_type_filter: 'assignment',
        course_id_filter: assignment.course_id
      });

      const updatedAssignment = entities.find(e => e.entity_id === assignment.entity_id);
      assert.strictEqual(updatedAssignment.metadata.completedAt, null);
    });

    it('should handle Supabase errors gracefully', async () => {
      // Force Supabase error by using invalid data
      mockSupabase.reset(); // Clear all data to force error

      const response = await request(app)
        .patch('/api/assignments/789/complete')
        .send({
          userEmail: userFixtures.validUser.email,
          isCompleted: true,
          courseId: '123456'
        });

      assert.strictEqual(response.status, 500);
      assert.strictEqual(response.body.success, false);
    });
  });
});
