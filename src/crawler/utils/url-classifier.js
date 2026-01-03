/**
 * URL Classifier for Canvas LMS
 * Classifies Canvas URLs by content type for organized extraction
 */

/**
 * Classifies a Canvas URL by its content type
 * @param {string} url - The URL to classify
 * @param {string} courseId - The course ID (optional, for validation)
 * @returns {string|null} - The content type or null if not a Canvas course URL
 */
function classifyCanvasUrl(url, courseId = null) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  // Normalize URL
  const normalizedUrl = url.trim();
  
  // Extract course ID from URL if not provided
  const courseIdMatch = normalizedUrl.match(/\/courses\/(\d+)/);
  const urlCourseId = courseIdMatch ? courseIdMatch[1] : null;
  
  // If courseId provided, only classify URLs from that course
  if (courseId && urlCourseId && urlCourseId !== courseId) {
    return null;
  }

  // Assignment URLs
  if (normalizedUrl.match(/\/courses\/\d+\/assignments(?:\/\d+)?/)) {
    return 'assignment';
  }

  // Module URLs
  if (normalizedUrl.match(/\/courses\/\d+\/modules(?:\/\d+)?/)) {
    return 'module';
  }

  // Files list / folder URLs
  if (normalizedUrl.match(/\/courses\/\d+\/files(?:\/folder\/[^\/?#]+)?(?:[\/?#].*)?$/)) {
    return 'files-list';
  }

  // Individual file detail URLs
  if (normalizedUrl.match(/\/files\/\d+(?:\/.*)?$/)) {
    return 'file';
  }

  // Page URLs
  if (normalizedUrl.match(/\/courses\/\d+\/pages\/[^\/]+/)) {
    return 'page';
  }

  // Announcements page URL
  if (normalizedUrl.match(/\/courses\/\d+\/announcements(?:\/|\?|$)/)) {
    return 'announcements-list';
  }

  // Announcement URLs (discussion topics that are announcements)
  // Canvas announcements are discussion topics, so we need to check the page content
  // For now, we'll classify based on URL pattern and let the extractor determine if it's an announcement
  if (normalizedUrl.match(/\/courses\/\d+\/discussion_topics\/\d+/) && 
      (normalizedUrl.includes('is_announcement') || normalizedUrl.includes('announcement'))) {
    return 'announcement';
  }

  // Discussion URLs (check after announcements to avoid conflicts)
  if (normalizedUrl.match(/\/courses\/\d+\/discussion_topics\/\d+/)) {
    // Note: This might be an announcement - will be determined during extraction
    return 'discussion';
  }

  // Quiz URLs
  if (normalizedUrl.match(/\/courses\/\d+\/quizzes(?:\/\d+)?/)) {
    return 'quiz';
  }

  // Grade URLs
  if (normalizedUrl.match(/\/courses\/\d+\/grades/)) {
    return 'grade';
  }

  // Syllabus URL - Canvas uses /courses/{id}/syllabus
  if (normalizedUrl.match(/\/courses\/\d+\/syllabus(?:\/|\?|$)/)) {
    return 'syllabus';
  }

  // Course home/dashboard
  if (normalizedUrl.match(/\/courses\/\d+(?:\/|\?|$)/) && 
      !normalizedUrl.match(/\/courses\/\d+\/(assignments|modules|files|pages|discussion_topics|quizzes|grades)/)) {
    return 'course';
  }

  // Not a recognized Canvas course URL
  return null;
}

/**
 * Extracts course ID from a Canvas URL
 * @param {string} url - The URL to extract course ID from
 * @returns {string|null} - The course ID or null if not found
 */
function extractCourseId(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  const match = url.match(/\/courses\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Checks if a URL is a Canvas course URL
 * @param {string} url - The URL to check
 * @returns {boolean} - True if it's a Canvas course URL
 */
function isCanvasCourseUrl(url) {
  return classifyCanvasUrl(url) !== null;
}

/**
 * Groups URLs by their classification
 * @param {Array<string>} urls - Array of URLs to classify and group
 * @param {string} courseId - Optional course ID to filter by
 * @returns {Object} - Object with classified URLs grouped by type
 */
function groupUrlsByType(urls, courseId = null) {
  const grouped = {
    assignments: [],
    modules: [],
    files: [],
    pages: [],
    announcements: [],
    discussions: [],
    quizzes: [],
    grades: [],
    syllabus: [],
    course: [],
    other: []
  };

  for (const url of urls) {
    const type = classifyCanvasUrl(url, courseId);
    if (type) {
      const key = type === 'assignment' ? 'assignments' :
                  type === 'module' ? 'modules' :
                  (type === 'file' || type === 'files-list') ? 'files' :
                  type === 'page' ? 'pages' :
                  type === 'announcement' ? 'announcements' :
                  type === 'announcements-list' ? 'announcements' : // Map announcements-list to announcements
                  type === 'discussion' ? 'discussions' :
                  type === 'quiz' ? 'quizzes' :
                  type === 'grade' ? 'grades' :
                  type === 'syllabus' ? 'syllabus' :
                  type === 'course' ? 'course' : 'other';
      grouped[key].push(url);
    } else {
      grouped.other.push(url);
    }
  }

  return grouped;
}

/**
 * Generates statistics from classified URLs
 * @param {Object} groupedUrls - Grouped URLs object from groupUrlsByType
 * @returns {Object} - Statistics object
 */
function generateStatistics(groupedUrls) {
  const stats = {
    totalUrls: 0,
    assignments: 0,
    modules: 0,
    files: 0,
    pages: 0,
    announcements: 0,
    discussions: 0,
    quizzes: 0,
    grades: 0,
    syllabus: 0,
    course: 0,
    other: 0
  };

  for (const [key, urls] of Object.entries(groupedUrls)) {
    const count = urls.length;
    stats[key] = count;
    stats.totalUrls += count;
  }

  return stats;
}

module.exports = {
  classifyCanvasUrl,
  extractCourseId,
  isCanvasCourseUrl,
  groupUrlsByType,
  generateStatistics
};

