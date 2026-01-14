/**
 * Course test fixtures
 * Static course data for testing
 */

const csci3308 = {
  id: '123456',
  user_email: 'test@colorado.edu',
  entity_type: 'course',
  entity_id: '123456',
  course_id: '123456',
  data: {
    id: 123456,
    name: 'CSCI 3308 - Software Development Methods and Tools',
    code: 'CSCI 3308',
    instructor: 'Dr. Smith',
    color: '#2196F3',
    enrollmentTermId: 1,
    workflowState: 'available',
    startAt: '2026-01-13T00:00:00.000Z',
    endAt: '2026-05-09T00:00:00.000Z',
  },
  metadata: {
    extractedAt: '2026-01-08T00:00:00.000Z',
    totalAssignments: 12,
    totalFiles: 45,
  },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-08T00:00:00.000Z',
};

const csci2400 = {
  id: '123457',
  user_email: 'test@colorado.edu',
  entity_type: 'course',
  entity_id: '123457',
  course_id: '123457',
  data: {
    id: 123457,
    name: 'CSCI 2400 - Computer Systems',
    code: 'CSCI 2400',
    instructor: 'Dr. Johnson',
    color: '#4CAF50',
    enrollmentTermId: 1,
    workflowState: 'available',
    startAt: '2026-01-13T00:00:00.000Z',
    endAt: '2026-05-09T00:00:00.000Z',
  },
  metadata: {
    extractedAt: '2026-01-08T00:00:00.000Z',
    totalAssignments: 15,
    totalFiles: 38,
  },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-08T00:00:00.000Z',
};

const math2400 = {
  id: '123458',
  user_email: 'test@colorado.edu',
  entity_type: 'course',
  entity_id: '123458',
  course_id: '123458',
  data: {
    id: 123458,
    name: 'MATH 2400 - Calculus II',
    code: 'MATH 2400',
    instructor: 'Prof. Williams',
    color: '#FF9800',
    enrollmentTermId: 1,
    workflowState: 'available',
    startAt: '2026-01-13T00:00:00.000Z',
    endAt: '2026-05-09T00:00:00.000Z',
  },
  metadata: {
    extractedAt: '2026-01-08T00:00:00.000Z',
    totalAssignments: 10,
    totalFiles: 25,
  },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-08T00:00:00.000Z',
};

const completedCourse = {
  id: '123459',
  user_email: 'test@colorado.edu',
  entity_type: 'course',
  entity_id: '123459',
  course_id: '123459',
  data: {
    id: 123459,
    name: 'CSCI 1300 - Introduction to Programming',
    code: 'CSCI 1300',
    instructor: 'Dr. Brown',
    color: '#9C27B0',
    enrollmentTermId: 0,
    workflowState: 'completed',
    startAt: '2025-08-26T00:00:00.000Z',
    endAt: '2025-12-20T00:00:00.000Z',
  },
  metadata: {
    extractedAt: '2025-12-20T00:00:00.000Z',
    totalAssignments: 20,
    totalFiles: 60,
  },
  created_at: '2025-08-26T00:00:00.000Z',
  updated_at: '2025-12-20T00:00:00.000Z',
};

const unpublishedCourse = {
  id: '123460',
  user_email: 'test@colorado.edu',
  entity_type: 'course',
  entity_id: '123460',
  course_id: '123460',
  data: {
    id: 123460,
    name: 'CSCI 4830 - Special Topics',
    code: 'CSCI 4830',
    instructor: 'TBD',
    color: '#607D8B',
    enrollmentTermId: 2,
    workflowState: 'unpublished',
    startAt: '2026-08-25T00:00:00.000Z',
    endAt: '2026-12-18T00:00:00.000Z',
  },
  metadata: {
    extractedAt: '2026-01-08T00:00:00.000Z',
    totalAssignments: 0,
    totalFiles: 0,
  },
  created_at: '2026-01-08T00:00:00.000Z',
  updated_at: '2026-01-08T00:00:00.000Z',
};

// Course list for API responses
const activeCourses = [csci3308, csci2400, math2400];
const allCourses = [csci3308, csci2400, math2400, completedCourse, unpublishedCourse];

// Course metadata for dashboard
const courseStats = {
  '123456': {
    totalAssignments: 12,
    completedAssignments: 5,
    upcomingAssignments: 7,
    totalFiles: 45,
    lastActivity: '2026-01-08T10:30:00.000Z',
  },
  '123457': {
    totalAssignments: 15,
    completedAssignments: 8,
    upcomingAssignments: 7,
    totalFiles: 38,
    lastActivity: '2026-01-07T14:20:00.000Z',
  },
  '123458': {
    totalAssignments: 10,
    completedAssignments: 3,
    upcomingAssignments: 7,
    totalFiles: 25,
    lastActivity: '2026-01-08T09:15:00.000Z',
  },
};

module.exports = {
  csci3308,
  csci2400,
  math2400,
  completedCourse,
  unpublishedCourse,
  activeCourses,
  allCourses,
  courseStats,

  // Helper to get course by ID
  getCourseById: (courseId) => allCourses.find(c => c.data.id === parseInt(courseId)),

  // Helper to get courses by status
  getCoursesByStatus: (status) => allCourses.filter(c => c.data.workflowState === status),
};
