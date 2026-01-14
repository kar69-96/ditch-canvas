/**
 * Assignment factory for generating test assignment data
 * Uses @faker-js/faker for realistic random data
 */

const { faker } = require('@faker-js/faker');

// Assignment types and topics
const assignmentTypes = [
  'Assignment',
  'Lab',
  'Project',
  'Quiz',
  'Homework',
  'Problem Set',
  'Essay',
  'Presentation',
  'Exam',
];

const assignmentTopics = {
  CSCI: [
    'Variables and Data Types',
    'Functions and Loops',
    'Data Structures',
    'Algorithms',
    'Object-Oriented Programming',
    'Web Development',
    'Database Design',
    'Testing and Debugging',
  ],
  MATH: [
    'Derivatives',
    'Integrals',
    'Linear Systems',
    'Differential Equations',
    'Proofs',
    'Applications',
  ],
  PHYS: [
    'Kinematics',
    'Dynamics',
    'Energy and Work',
    'Thermodynamics',
    'Wave Motion',
    'Electricity and Magnetism',
  ],
};

const submissionTypes = [
  ['online_upload'],
  ['online_text_entry'],
  ['online_url'],
  ['online_quiz'],
  ['online_upload', 'online_url'],
  ['online_upload', 'online_text_entry'],
];

/**
 * Create a single assignment with optional overrides
 * @param {Object} overrides - Properties to override
 * @returns {Object} Assignment object
 */
function createAssignment(overrides = {}) {
  const assignmentId = overrides.assignmentId || faker.string.numeric(6);
  const courseId = overrides.courseId || faker.string.numeric(6);
  const userEmail = overrides.user_email || 'test@colorado.edu';

  const assignmentType = faker.helpers.arrayElement(assignmentTypes);
  const assignmentNumber = faker.number.int({ min: 1, max: 15 });
  const coursePre fix = overrides.courseCode?.split(' ')[0] || 'CSCI';
  const topic = faker.helpers.arrayElement(assignmentTopics[coursePrefix] || ['General Topic']);

  const title = `${assignmentType} ${assignmentNumber}: ${topic}`;

  // Generate dates
  const assignedAt = faker.date.recent({ days: 14 });
  const dueAt = new Date(assignedAt);
  dueAt.setDate(dueAt.getDate() + faker.number.int({ min: 3, max: 14 }));

  return {
    id: `assign-${assignmentId}`,
    user_email: userEmail,
    entity_type: 'assignment',
    entity_id: assignmentId,
    course_id: courseId,
    data: {
      id: parseInt(assignmentId),
      title,
      dueAt: dueAt.toISOString(),
      assignedAt: assignedAt.toISOString(),
      courseId: parseInt(courseId),
      courseName: overrides.courseName || `${coursePrefix} - Sample Course`,
      courseCode: overrides.courseCode || coursePrefix,
      pointsPossible: faker.helpers.arrayElement([25, 50, 75, 100, 150, 200]),
      submissionStatus: 'no',
      workflowState: 'published',
      url: `https://canvas.colorado.edu/courses/${courseId}/assignments/${assignmentId}`,
      description: `<p>${faker.lorem.paragraph()}</p>`,
      submissionTypes: faker.helpers.arrayElement(submissionTypes),
    },
    metadata: {
      userMarkedComplete: false,
      userNotes: null,
      userPriority: faker.number.int({ min: 1, max: 5 }),
      extractedAt: new Date().toISOString(),
      extractionVersion: '1.0.0',
    },
    created_at: assignedAt.toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create multiple assignments
 * @param {number} count - Number of assignments to create
 * @param {Object} overrides - Properties to override for all assignments
 * @returns {Array} Array of assignment objects
 */
function createAssignments(count, overrides = {}) {
  return Array.from({ length: count }, () => createAssignment(overrides));
}

/**
 * Create an upcoming assignment (due in the future)
 * @param {Object} overrides - Properties to override
 * @returns {Object} Assignment object
 */
function createUpcomingAssignment(overrides = {}) {
  const daysUntilDue = faker.number.int({ min: 1, max: 14 });
  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + daysUntilDue);

  const assignedAt = new Date();
  assignedAt.setDate(assignedAt.getDate() - faker.number.int({ min: 1, max: 7 }));

  return createAssignment({
    data: {
      ...createAssignment().data,
      dueAt: dueAt.toISOString(),
      assignedAt: assignedAt.toISOString(),
      submissionStatus: 'no',
    },
    metadata: {
      ...createAssignment().metadata,
      userMarkedComplete: false,
    },
    ...overrides,
  });
}

/**
 * Create a submitted assignment
 * @param {Object} overrides - Properties to override
 * @returns {Object} Assignment object
 */
function createSubmittedAssignment(overrides = {}) {
  const dueAt = faker.date.past({ days: 7 });
  const assignedAt = new Date(dueAt);
  assignedAt.setDate(assignedAt.getDate() - faker.number.int({ min: 7, max: 14 }));

  return createAssignment({
    data: {
      ...createAssignment().data,
      dueAt: dueAt.toISOString(),
      assignedAt: assignedAt.toISOString(),
      submissionStatus: 'yes',
    },
    metadata: {
      ...createAssignment().metadata,
      userMarkedComplete: true,
      userNotes: 'Submitted on time',
    },
    updated_at: dueAt.toISOString(),
    ...overrides,
  });
}

/**
 * Create an overdue assignment (past due, not submitted)
 * @param {Object} overrides - Properties to override
 * @returns {Object} Assignment object
 */
function createOverdueAssignment(overrides = {}) {
  const daysOverdue = faker.number.int({ min: 1, max: 30 });
  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() - daysOverdue);

  const assignedAt = new Date(dueAt);
  assignedAt.setDate(assignedAt.getDate() - faker.number.int({ min: 7, max: 14 }));

  return createAssignment({
    data: {
      ...createAssignment().data,
      dueAt: dueAt.toISOString(),
      assignedAt: assignedAt.toISOString(),
      submissionStatus: 'no',
    },
    metadata: {
      ...createAssignment().metadata,
      userMarkedComplete: false,
      userPriority: 5,
      userNotes: 'Need to complete ASAP',
    },
    ...overrides,
  });
}

/**
 * Create a quiz assignment
 * @param {Object} overrides - Properties to override
 * @returns {Object} Assignment object with quiz properties
 */
function createQuizAssignment(overrides = {}) {
  return createAssignment({
    data: {
      ...createAssignment().data,
      submissionTypes: ['online_quiz'],
      isQuiz: true,
      timeLimit: faker.helpers.arrayElement([15, 30, 45, 60, 90]),
      allowedAttempts: faker.helpers.arrayElement([1, 2, 3, -1]), // -1 = unlimited
      questionCount: faker.number.int({ min: 5, max: 50 }),
      pointsPossible: faker.helpers.arrayElement([25, 50, 75, 100]),
    },
    ...overrides,
  });
}

/**
 * Create an assignment with no due date
 * @param {Object} overrides - Properties to override
 * @returns {Object} Assignment object with null due date
 */
function createNoDueDateAssignment(overrides = {}) {
  return createAssignment({
    data: {
      ...createAssignment().data,
      title: `Extra Credit: ${faker.helpers.arrayElement(['Code Review', 'Research Paper', 'Presentation', 'Tutorial'])}`,
      dueAt: null,
      pointsPossible: faker.helpers.arrayElement([10, 20, 30, 50]),
    },
    metadata: {
      ...createAssignment().metadata,
      userPriority: 1,
    },
    ...overrides,
  });
}

/**
 * Create a group project assignment
 * @param {Object} overrides - Properties to override
 * @returns {Object} Assignment object
 */
function createGroupProjectAssignment(overrides = {}) {
  const dueAt = faker.date.future({ months: 2 });
  const assignedAt = faker.date.recent({ days: 7 });

  return createAssignment({
    data: {
      ...createAssignment().data,
      title: `Team Project: ${faker.helpers.arrayElement(['Web Application', 'Mobile App', 'Research Paper', 'Presentation'])}`,
      dueAt: dueAt.toISOString(),
      assignedAt: assignedAt.toISOString(),
      pointsPossible: faker.helpers.arrayElement([200, 300, 400, 500]),
      submissionTypes: ['online_upload', 'online_url'],
      description: '<p>Build a project with your team. Requirements: ...</p>',
    },
    metadata: {
      ...createAssignment().metadata,
      userPriority: 5,
      userNotes: `Team: ${faker.person.firstName()}, ${faker.person.firstName()}, ${faker.person.firstName()}`,
    },
    ...overrides,
  });
}

/**
 * Create assignments for a specific course
 * @param {string} courseId - Course ID
 * @param {number} count - Number of assignments
 * @param {Object} overrides - Properties to override
 * @returns {Array} Array of assignment objects
 */
function createAssignmentsForCourse(courseId, count = 10, overrides = {}) {
  return Array.from({ length: count }, (_, index) => {
    // Mix of upcoming, submitted, and overdue
    const rand = Math.random();
    if (rand < 0.4) {
      return createUpcomingAssignment({ courseId, ...overrides });
    } else if (rand < 0.7) {
      return createSubmittedAssignment({ courseId, ...overrides });
    } else {
      return createOverdueAssignment({ courseId, ...overrides });
    }
  });
}

module.exports = {
  createAssignment,
  createAssignments,
  createUpcomingAssignment,
  createSubmittedAssignment,
  createOverdueAssignment,
  createQuizAssignment,
  createNoDueDateAssignment,
  createGroupProjectAssignment,
  createAssignmentsForCourse,
  assignmentTypes,
  assignmentTopics,
};
