/**
 * Assignment test fixtures
 * Static assignment data for testing
 */

const upcomingAssignment = {
  id: 'assign-1',
  user_email: 'test@colorado.edu',
  entity_type: 'assignment',
  entity_id: '789',
  course_id: '123456',
  data: {
    id: 789,
    title: 'Assignment 1: Variables and Data Types',
    dueAt: '2026-01-15T23:59:00.000Z',
    assignedAt: '2026-01-08T08:00:00.000Z',
    courseId: 123456,
    courseName: 'CSCI 3308 - Software Development Methods and Tools',
    courseCode: 'CSCI 3308',
    pointsPossible: 100,
    submissionStatus: 'no',
    workflowState: 'published',
    url: 'https://canvas.colorado.edu/courses/123456/assignments/789',
    description: '<p>Complete the exercises on variables and data types in Python.</p>',
    submissionTypes: ['online_upload'],
  },
  metadata: {
    userMarkedComplete: false,
    userNotes: null,
    userPriority: 3,
    extractedAt: '2026-01-08T00:00:00.000Z',
    extractionVersion: '1.0.0',
  },
  created_at: '2026-01-08T00:00:00.000Z',
  updated_at: '2026-01-08T00:00:00.000Z',
};

const submittedAssignment = {
  id: 'assign-2',
  user_email: 'test@colorado.edu',
  entity_type: 'assignment',
  entity_id: '790',
  course_id: '123456',
  data: {
    id: 790,
    title: 'Assignment 2: Functions and Loops',
    dueAt: '2026-01-10T23:59:00.000Z',
    assignedAt: '2026-01-03T08:00:00.000Z',
    courseId: 123456,
    courseName: 'CSCI 3308 - Software Development Methods and Tools',
    courseCode: 'CSCI 3308',
    pointsPossible: 100,
    submissionStatus: 'yes',
    workflowState: 'published',
    url: 'https://canvas.colorado.edu/courses/123456/assignments/790',
    description: '<p>Write functions and use loops to solve programming problems.</p>',
    submissionTypes: ['online_upload'],
  },
  metadata: {
    userMarkedComplete: true,
    userNotes: 'Submitted on time',
    userPriority: 5,
    extractedAt: '2026-01-10T00:00:00.000Z',
    extractionVersion: '1.0.0',
  },
  created_at: '2026-01-03T00:00:00.000Z',
  updated_at: '2026-01-10T12:00:00.000Z',
};

const pastDueAssignment = {
  id: 'assign-3',
  user_email: 'test@colorado.edu',
  entity_type: 'assignment',
  entity_id: '791',
  course_id: '123457',
  data: {
    id: 791,
    title: 'Lab 1: Binary Representation',
    dueAt: '2026-01-05T23:59:00.000Z',
    assignedAt: '2025-12-20T08:00:00.000Z',
    courseId: 123457,
    courseName: 'CSCI 2400 - Computer Systems',
    courseCode: 'CSCI 2400',
    pointsPossible: 50,
    submissionStatus: 'no',
    workflowState: 'published',
    url: 'https://canvas.colorado.edu/courses/123457/assignments/791',
    description: '<p>Lab exercises on binary representation and arithmetic.</p>',
    submissionTypes: ['online_upload'],
  },
  metadata: {
    userMarkedComplete: false,
    userNotes: 'Need to complete ASAP',
    userPriority: 5,
    extractedAt: '2026-01-08T00:00:00.000Z',
    extractionVersion: '1.0.0',
  },
  created_at: '2025-12-20T00:00:00.000Z',
  updated_at: '2026-01-08T00:00:00.000Z',
};

const quizAssignment = {
  id: 'assign-4',
  user_email: 'test@colorado.edu',
  entity_type: 'assignment',
  entity_id: '792',
  course_id: '123458',
  data: {
    id: 792,
    title: 'Quiz 1: Derivatives',
    dueAt: '2026-01-12T23:59:00.000Z',
    assignedAt: '2026-01-06T08:00:00.000Z',
    courseId: 123458,
    courseName: 'MATH 2400 - Calculus II',
    courseCode: 'MATH 2400',
    pointsPossible: 25,
    submissionStatus: 'no',
    workflowState: 'published',
    url: 'https://canvas.colorado.edu/courses/123458/assignments/792',
    description: '<p>Online quiz covering derivatives.</p>',
    submissionTypes: ['online_quiz'],
    isQuiz: true,
    timeLimit: 30,
    allowedAttempts: 1,
    questionCount: 10,
  },
  metadata: {
    userMarkedComplete: false,
    userNotes: 'Review derivatives before taking',
    userPriority: 4,
    extractedAt: '2026-01-08T00:00:00.000Z',
    extractionVersion: '1.0.0',
  },
  created_at: '2026-01-06T00:00:00.000Z',
  updated_at: '2026-01-08T00:00:00.000Z',
};

const noDueDateAssignment = {
  id: 'assign-5',
  user_email: 'test@colorado.edu',
  entity_type: 'assignment',
  entity_id: '793',
  course_id: '123456',
  data: {
    id: 793,
    title: 'Extra Credit: Code Review',
    dueAt: null,
    assignedAt: '2026-01-08T08:00:00.000Z',
    courseId: 123456,
    courseName: 'CSCI 3308 - Software Development Methods and Tools',
    courseCode: 'CSCI 3308',
    pointsPossible: 20,
    submissionStatus: 'no',
    workflowState: 'published',
    url: 'https://canvas.colorado.edu/courses/123456/assignments/793',
    description: '<p>Optional extra credit: Review a classmate\'s code.</p>',
    submissionTypes: ['online_text_entry'],
  },
  metadata: {
    userMarkedComplete: false,
    userNotes: null,
    userPriority: 1,
    extractedAt: '2026-01-08T00:00:00.000Z',
    extractionVersion: '1.0.0',
  },
  created_at: '2026-01-08T00:00:00.000Z',
  updated_at: '2026-01-08T00:00:00.000Z',
};

const groupProjectAssignment = {
  id: 'assign-6',
  user_email: 'test@colorado.edu',
  entity_type: 'assignment',
  entity_id: '794',
  course_id: '123456',
  data: {
    id: 794,
    title: 'Team Project: Web Application',
    dueAt: '2026-03-15T23:59:00.000Z',
    assignedAt: '2026-01-08T08:00:00.000Z',
    courseId: 123456,
    courseName: 'CSCI 3308 - Software Development Methods and Tools',
    courseCode: 'CSCI 3308',
    pointsPossible: 300,
    submissionStatus: 'no',
    workflowState: 'published',
    url: 'https://canvas.colorado.edu/courses/123456/assignments/794',
    description: '<p>Build a full-stack web application with your team.</p>',
    submissionTypes: ['online_upload', 'online_url'],
  },
  metadata: {
    userMarkedComplete: false,
    userNotes: 'Team: Alice, Bob, Charlie',
    userPriority: 5,
    extractedAt: '2026-01-08T00:00:00.000Z',
    extractionVersion: '1.0.0',
  },
  created_at: '2026-01-08T00:00:00.000Z',
  updated_at: '2026-01-08T00:00:00.000Z',
};

// Assignment arrays for different scenarios
const upcomingAssignments = [upcomingAssignment, quizAssignment, noDueDateAssignment, groupProjectAssignment];
const completedAssignments = [submittedAssignment];
const overdueAssignments = [pastDueAssignment];
const allAssignments = [
  upcomingAssignment,
  submittedAssignment,
  pastDueAssignment,
  quizAssignment,
  noDueDateAssignment,
  groupProjectAssignment,
];

// Assignment statistics
const assignmentStats = {
  total: 6,
  upcoming: 4,
  completed: 1,
  overdue: 1,
  totalPoints: 595,
  completedPoints: 100,
};

module.exports = {
  upcomingAssignment,
  submittedAssignment,
  pastDueAssignment,
  quizAssignment,
  noDueDateAssignment,
  groupProjectAssignment,
  upcomingAssignments,
  completedAssignments,
  overdueAssignments,
  allAssignments,
  assignmentStats,

  // Helper to get assignment by ID
  getAssignmentById: (assignmentId) =>
    allAssignments.find(a => a.data.id === parseInt(assignmentId)),

  // Helper to get assignments by course
  getAssignmentsByCourse: (courseId) =>
    allAssignments.filter(a => a.data.courseId === parseInt(courseId)),

  // Helper to get assignments by status
  getAssignmentsByStatus: (status) => {
    const now = new Date();
    if (status === 'upcoming') {
      return allAssignments.filter(
        a => a.data.dueAt && new Date(a.data.dueAt) > now && a.data.submissionStatus === 'no'
      );
    }
    if (status === 'completed') {
      return allAssignments.filter(a => a.metadata.userMarkedComplete || a.data.submissionStatus === 'yes');
    }
    if (status === 'overdue') {
      return allAssignments.filter(
        a => a.data.dueAt && new Date(a.data.dueAt) < now && a.data.submissionStatus === 'no'
      );
    }
    return [];
  },
};
