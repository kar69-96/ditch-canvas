/**
 * Course factory for generating test course data
 * Uses @faker-js/faker for realistic random data
 */

const { faker } = require('@faker-js/faker');

// Course prefixes and names for realistic course generation
const coursePrefixes = ['CSCI', 'MATH', 'PHYS', 'CHEM', 'ECON', 'PSYC', 'HIST', 'ENGL'];
const courseTopics = {
  CSCI: [
    'Introduction to Programming',
    'Data Structures',
    'Algorithms',
    'Computer Systems',
    'Software Development Methods and Tools',
    'Artificial Intelligence',
    'Machine Learning',
    'Web Development',
  ],
  MATH: [
    'Calculus I',
    'Calculus II',
    'Linear Algebra',
    'Differential Equations',
    'Discrete Mathematics',
    'Probability and Statistics',
  ],
  PHYS: [
    'General Physics I',
    'General Physics II',
    'Modern Physics',
    'Quantum Mechanics',
    'Thermodynamics',
  ],
  CHEM: [
    'General Chemistry I',
    'General Chemistry II',
    'Organic Chemistry',
    'Physical Chemistry',
  ],
  ECON: [
    'Principles of Microeconomics',
    'Principles of Macroeconomics',
    'Intermediate Microeconomics',
    'Econometrics',
  ],
  PSYC: [
    'Introduction to Psychology',
    'Cognitive Psychology',
    'Developmental Psychology',
    'Social Psychology',
  ],
  HIST: [
    'American History',
    'World History',
    'Medieval History',
    'Modern European History',
  ],
  ENGL: [
    'Composition I',
    'Composition II',
    'American Literature',
    'British Literature',
  ],
};

const instructorTitles = ['Dr.', 'Prof.', 'Mr.', 'Ms.', 'Mrs.'];
const colors = ['#2196F3', '#4CAF50', '#FF9800', '#9C27B0', '#F44336', '#607D8B', '#00BCD4', '#FFEB3B'];

/**
 * Create a single course with optional overrides
 * @param {Object} overrides - Properties to override
 * @returns {Object} Course object
 */
function createCourse(overrides = {}) {
  const coursePrefix = overrides.coursePrefix || faker.helpers.arrayElement(coursePrefixes);
  const courseNumber = overrides.courseNumber || faker.number.int({ min: 1000, max: 4999 });
  const courseCode = `${coursePrefix} ${courseNumber}`;
  const courseName = overrides.courseName || faker.helpers.arrayElement(courseTopics[coursePrefix] || ['Special Topics']);
  const courseId = overrides.courseId || faker.string.numeric(6);
  const userEmail = overrides.user_email || 'test@colorado.edu';

  const instructorTitle = faker.helpers.arrayElement(instructorTitles);
  const instructorLastName = faker.person.lastName();
  const instructor = `${instructorTitle} ${instructorLastName}`;

  const termStart = faker.date.recent({ days: 30 });
  const termEnd = new Date(termStart);
  termEnd.setMonth(termEnd.getMonth() + 4);

  return {
    id: `course-${courseId}`,
    user_email: userEmail,
    entity_type: 'course',
    entity_id: courseId,
    course_id: courseId,
    data: {
      id: parseInt(courseId),
      name: `${courseCode} - ${courseName}`,
      code: courseCode,
      instructor,
      color: faker.helpers.arrayElement(colors),
      enrollmentTermId: faker.number.int({ min: 1, max: 10 }),
      workflowState: 'available',
      startAt: termStart.toISOString(),
      endAt: termEnd.toISOString(),
    },
    metadata: {
      extractedAt: new Date().toISOString(),
      totalAssignments: faker.number.int({ min: 5, max: 20 }),
      totalFiles: faker.number.int({ min: 10, max: 100 }),
    },
    created_at: termStart.toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create multiple courses
 * @param {number} count - Number of courses to create
 * @param {Object} overrides - Properties to override for all courses
 * @returns {Array} Array of course objects
 */
function createCourses(count, overrides = {}) {
  return Array.from({ length: count }, () => createCourse(overrides));
}

/**
 * Create a Computer Science course
 * @param {Object} overrides - Properties to override
 * @returns {Object} Course object
 */
function createCSCourse(overrides = {}) {
  return createCourse({
    coursePrefix: 'CSCI',
    ...overrides,
  });
}

/**
 * Create a Math course
 * @param {Object} overrides - Properties to override
 * @returns {Object} Course object
 */
function createMathCourse(overrides = {}) {
  return createCourse({
    coursePrefix: 'MATH',
    ...overrides,
  });
}

/**
 * Create a completed course (past term)
 * @param {Object} overrides - Properties to override
 * @returns {Object} Course object with completed status
 */
function createCompletedCourse(overrides = {}) {
  const termEnd = faker.date.past({ years: 1 });
  const termStart = new Date(termEnd);
  termStart.setMonth(termStart.getMonth() - 4);

  return createCourse({
    data: {
      ...createCourse().data,
      workflowState: 'completed',
      startAt: termStart.toISOString(),
      endAt: termEnd.toISOString(),
    },
    ...overrides,
  });
}

/**
 * Create an unpublished course (future term)
 * @param {Object} overrides - Properties to override
 * @returns {Object} Course object with unpublished status
 */
function createUnpublishedCourse(overrides = {}) {
  const termStart = faker.date.future({ years: 1 });
  const termEnd = new Date(termStart);
  termEnd.setMonth(termEnd.getMonth() + 4);

  return createCourse({
    data: {
      ...createCourse().data,
      workflowState: 'unpublished',
      instructor: 'TBD',
      startAt: termStart.toISOString(),
      endAt: termEnd.toISOString(),
    },
    metadata: {
      extractedAt: new Date().toISOString(),
      totalAssignments: 0,
      totalFiles: 0,
    },
    ...overrides,
  });
}

/**
 * Create a semester schedule of courses (4-6 courses)
 * @param {string} userEmail - User email
 * @param {Object} overrides - Properties to override
 * @returns {Array} Array of course objects
 */
function createSemesterSchedule(userEmail = 'test@colorado.edu', overrides = {}) {
  const courseCount = faker.number.int({ min: 4, max: 6 });
  const usedPrefixes = new Set();

  return Array.from({ length: courseCount }, () => {
    // Ensure diverse courses
    let coursePrefix = faker.helpers.arrayElement(coursePrefixes);
    while (usedPrefixes.has(coursePrefix) && usedPrefixes.size < coursePrefixes.length) {
      coursePrefix = faker.helpers.arrayElement(coursePrefixes);
    }
    usedPrefixes.add(coursePrefix);

    return createCourse({
      user_email: userEmail,
      coursePrefix,
      ...overrides,
    });
  });
}

/**
 * Create course with specific stats
 * @param {Object} stats - Course statistics
 * @param {Object} overrides - Properties to override
 * @returns {Object} Course object
 */
function createCourseWithStats(stats = {}, overrides = {}) {
  return createCourse({
    metadata: {
      extractedAt: new Date().toISOString(),
      totalAssignments: stats.totalAssignments || faker.number.int({ min: 5, max: 20 }),
      totalFiles: stats.totalFiles || faker.number.int({ min: 10, max: 100 }),
      completedAssignments: stats.completedAssignments || 0,
      upcomingAssignments: stats.upcomingAssignments || 0,
      lastActivity: stats.lastActivity || new Date().toISOString(),
    },
    ...overrides,
  });
}

module.exports = {
  createCourse,
  createCourses,
  createCSCourse,
  createMathCourse,
  createCompletedCourse,
  createUnpublishedCourse,
  createSemesterSchedule,
  createCourseWithStats,
  coursePrefixes,
  courseTopics,
};
