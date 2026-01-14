/**
 * Mock Canvas LMS API responses for testing
 * Provides realistic HTML and JSON responses that extractors can parse
 */

const sampleAssignmentHTML = `
<!DOCTYPE html>
<html>
<head><title>Assignment 1 - Intro to Programming</title></head>
<body>
  <div class="assignment-details">
    <h1 class="title">Assignment 1: Variables and Data Types</h1>
    <div class="details">
      <span class="due-date">Due: Jan 15, 2026 at 11:59pm</span>
      <span class="points">Points: 100</span>
      <span class="submission-status">Not Submitted</span>
    </div>
    <div class="description">
      <p>Complete the exercises on variables and data types in Python.</p>
      <p>Submit your code as a .py file.</p>
    </div>
  </div>
</body>
</html>
`;

const sampleCourseHTML = `
<!DOCTYPE html>
<html>
<head><title>CSCI 3308</title></head>
<body>
  <div class="course-details">
    <h1>CSCI 3308 - Software Development Methods and Tools</h1>
    <div class="instructor">Instructor: Dr. Smith</div>
    <div class="term">Spring 2026</div>
  </div>
  <div class="course-menu">
    <a href="/courses/123456/assignments">Assignments</a>
    <a href="/courses/123456/modules">Modules</a>
    <a href="/courses/123456/files">Files</a>
  </div>
</body>
</html>
`;

const sampleModuleHTML = `
<!DOCTYPE html>
<html>
<body>
  <div class="context_module">
    <div class="header">
      <h2>Week 1: Introduction</h2>
    </div>
    <div class="content">
      <div class="context_module_item" data-module-item-id="1">
        <a href="/courses/123456/assignments/789">Assignment 1</a>
      </div>
      <div class="context_module_item" data-module-item-id="2">
        <a href="/courses/123456/pages/welcome">Welcome Page</a>
      </div>
      <div class="context_module_item" data-module-item-id="3">
        <a href="/courses/123456/files/456">Syllabus.pdf</a>
      </div>
    </div>
  </div>
</body>
</html>
`;

const sampleFileListHTML = `
<!DOCTYPE html>
<html>
<body>
  <div class="file-list">
    <div class="file-item" data-file-id="456">
      <a href="/files/456/download">Syllabus.pdf</a>
      <span class="size">1.2 MB</span>
      <span class="modified">Modified Jan 5, 2026</span>
    </div>
    <div class="file-item" data-file-id="457">
      <a href="/files/457/download">Lecture1.pptx</a>
      <span class="size">5.4 MB</span>
      <span class="modified">Modified Jan 8, 2026</span>
    </div>
  </div>
</body>
</html>
`;

// JSON API responses
const sampleCoursesJSON = [
  {
    id: 123456,
    name: 'CSCI 3308 - Software Development Methods and Tools',
    course_code: 'CSCI 3308',
    workflow_state: 'available',
    enrollments: [{ type: 'student', role: 'StudentEnrollment' }],
    term: { id: 1, name: 'Spring 2026' },
  },
  {
    id: 123457,
    name: 'CSCI 2400 - Computer Systems',
    course_code: 'CSCI 2400',
    workflow_state: 'available',
    enrollments: [{ type: 'student', role: 'StudentEnrollment' }],
    term: { id: 1, name: 'Spring 2026' },
  },
];

const sampleAssignmentsJSON = [
  {
    id: 789,
    name: 'Assignment 1: Variables and Data Types',
    description: '<p>Complete the exercises on variables and data types in Python.</p>',
    due_at: '2026-01-15T23:59:00Z',
    points_possible: 100,
    course_id: 123456,
    submission_types: ['online_upload'],
    workflow_state: 'published',
    has_submitted_submissions: false,
  },
  {
    id: 790,
    name: 'Assignment 2: Functions and Loops',
    description: '<p>Write functions and use loops to solve problems.</p>',
    due_at: '2026-01-22T23:59:00Z',
    points_possible: 100,
    course_id: 123456,
    submission_types: ['online_upload'],
    workflow_state: 'published',
    has_submitted_submissions: true,
  },
];

const sampleModulesJSON = [
  {
    id: 1,
    name: 'Week 1: Introduction',
    position: 1,
    unlock_at: null,
    items: [
      {
        id: 1,
        title: 'Assignment 1',
        type: 'Assignment',
        content_id: 789,
        html_url: 'https://canvas.edu/courses/123456/assignments/789',
      },
      {
        id: 2,
        title: 'Welcome Page',
        type: 'Page',
        page_url: 'welcome',
        html_url: 'https://canvas.edu/courses/123456/pages/welcome',
      },
    ],
  },
];

/**
 * Mock Canvas API client
 */
class MockCanvasAPI {
  constructor() {
    this.baseUrl = 'https://canvas.test.edu';
    this.requests = [];
  }

  // Reset request history
  reset() {
    this.requests = [];
  }

  // Track request
  trackRequest(method, path, options = {}) {
    this.requests.push({ method, path, options, timestamp: Date.now() });
  }

  // Get sample HTML response
  getHTML(path) {
    this.trackRequest('GET', path);

    if (path.includes('/assignments/')) {
      return sampleAssignmentHTML;
    }
    if (path.includes('/courses/') && !path.includes('/assignments')) {
      return sampleCourseHTML;
    }
    if (path.includes('/modules')) {
      return sampleModuleHTML;
    }
    if (path.includes('/files')) {
      return sampleFileListHTML;
    }

    return '<html><body>Mock Canvas Page</body></html>';
  }

  // Get sample JSON response
  getJSON(path) {
    this.trackRequest('GET', path);

    if (path.includes('/api/v1/courses') && !path.includes('/assignments')) {
      return sampleCoursesJSON;
    }
    if (path.includes('/assignments')) {
      return sampleAssignmentsJSON;
    }
    if (path.includes('/modules')) {
      return sampleModulesJSON;
    }

    return {};
  }

  // Mock fetch-like response
  async fetch(url, options = {}) {
    const method = options.method || 'GET';
    this.trackRequest(method, url, options);

    const isJSON = url.includes('/api/v1/');
    const body = isJSON ? this.getJSON(url) : this.getHTML(url);

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map([
        ['content-type', isJSON ? 'application/json' : 'text/html'],
      ]),
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  }

  // Helper: Verify request was made
  wasRequestMade(path) {
    return this.requests.some(req => req.path.includes(path));
  }

  // Helper: Get request count
  getRequestCount(path = null) {
    if (!path) return this.requests.length;
    return this.requests.filter(req => req.path.includes(path)).length;
  }

  // Helper: Get all requests
  getAllRequests() {
    return this.requests;
  }
}

// Create singleton instance
const mockCanvasAPI = new MockCanvasAPI();

// Export
module.exports = {
  mockCanvasAPI,
  MockCanvasAPI,
  sampleAssignmentHTML,
  sampleCourseHTML,
  sampleModuleHTML,
  sampleFileListHTML,
  sampleCoursesJSON,
  sampleAssignmentsJSON,
  sampleModulesJSON,

  // Setup function
  setupMockCanvasAPI: () => {
    mockCanvasAPI.reset();
    return mockCanvasAPI;
  },

  // Cleanup function
  cleanupMockCanvasAPI: () => {
    mockCanvasAPI.reset();
  },
};
