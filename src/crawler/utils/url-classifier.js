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

  // Discussion URLs (announcements are discussion topics)
  if (normalizedUrl.match(/\/courses\/\d+\/discussion_topics\/\d+/)) {
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

  // Syllabus URL
  if (normalizedUrl.match(/\/courses\/\d+\/syllabus(?:\/|\?|$)/)) {
    return 'syllabus';
  }

  // Course home/dashboard
  if (normalizedUrl.match(/\/courses\/\d+(?:\/|\?|$)/) &&
      !normalizedUrl.match(/\/courses\/\d+\/(assignments|modules|files|pages|discussion_topics|quizzes|grades)/)) {
    return 'course';
  }

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

module.exports = {
  classifyCanvasUrl,
  extractCourseId,
  isCanvasCourseUrl
};
