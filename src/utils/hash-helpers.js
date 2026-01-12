const crypto = require('crypto');

/**
 * Centralized hash functions for consistent content hashing
 * Used by integration sync services to detect content changes
 */

/**
 * Hash assignment data to detect changes
 * Uses stable fields that represent assignment content
 *
 * @param {Object} assignment - Assignment object with flexible field names
 * @returns {string} SHA-256 hash of assignment content
 */
function hashAssignment(assignment) {
  const payload = {
    title: assignment.title || '',
    courseCode: assignment.course_code || assignment.courseCode || '',
    dueDate: assignment.due_date || assignment.dueDate || null,
    pointsPossible: assignment.points_possible ?? assignment.pointsPossible ?? null,
    workflowState: assignment.workflow_state || assignment.workflowState || '',
    url: assignment.url || '',
    isCompleted: assignment.isCompleted ?? false,
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

module.exports = {
  hashAssignment,
};
