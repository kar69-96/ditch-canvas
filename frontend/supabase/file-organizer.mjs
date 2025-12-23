/**
 * File Organization Utility (ES Module)
 * Organizes course files into structured folders based on metadata
 */

/**
 * Extract week number from text
 */
export function extractWeek(text) {
  if (!text) return null;
  const patterns = [
    /week\s*(\d+)/i,
    /w(\d+)/i,
    /(\d+)\s*week/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return parseInt(match[1]);
    }
  }
  return null;
}

/**
 * Extract chapter number from filename
 */
export function extractChapter(filename) {
  if (!filename) return null;
  const match = filename.match(/Ch\s*(\d+)/i);
  return match ? parseInt(match[1]) : null;
}

/**
 * Classify file type based on filename
 */
export function classifyFileType(filename) {
  if (!filename) return 'other';
  const lower = filename.toLowerCase();
  if (lower.includes('syllabus')) return 'syllabus';
  if (lower.includes('problem') || lower.includes('probset')) return 'problem';
  if (lower.includes('answer') || lower.includes('solution') || lower.includes('key')) return 'solution';
  if (lower.includes('practice')) return 'practice';
  if (lower.includes('exam') || lower.includes('midterm') || lower.includes('final')) return 'exam';
  if (lower.endsWith('.pptx') || lower.includes('lecture') || lower.includes('ch')) return 'lecture';
  return 'other';
}

/**
 * Sanitize filename for use in path
 */
export function sanitizePathSegment(segment) {
  if (!segment) return '';
  return segment
    .replace(/[^a-z0-9\s-]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '-');
}

/**
 * Organize file path based on metadata
 * Strategy: Hybrid - combines week, module, content type, and chapter
 */
export function organizeFileByMetadata(fileData, metadata = {}) {
  // Extract metadata
  const week = metadata.extractedWeek || extractWeek(fileData.moduleName || fileData.name || '');
  const chapter = metadata.extractedChapter || extractChapter(fileData.name || '');
  const contentType = metadata.extractedContentType || classifyFileType(fileData.name || '');
  const moduleName = fileData.moduleName || metadata.moduleName;
  const folderPath = fileData.folderPath || metadata.folderPath || [];
  
  const pathSegments = [];
  
  // Primary organization: Week or Module
  if (week) {
    pathSegments.push(`Week ${week}`);
  } else if (moduleName && !moduleName.toLowerCase().includes('week')) {
    // Use module name if it's not week-based
    const sanitizedModule = sanitizePathSegment(moduleName);
    if (sanitizedModule) {
      pathSegments.push(sanitizedModule);
    }
  } else if (folderPath && folderPath.length > 0) {
    // Use folder path if available
    const relevantPath = folderPath.filter(p => 
      p && p.toLowerCase() !== 'modules' && p.toLowerCase() !== 'files'
    );
    if (relevantPath.length > 0) {
      pathSegments.push(...relevantPath.map(sanitizePathSegment));
    }
  } else {
    pathSegments.push('Other Content');
  }
  
  // Secondary organization: Content Type (no subfolders)
  if (contentType === 'lecture') {
    pathSegments.push('Lectures');
  } else if (contentType === 'practice') {
    pathSegments.push('Practice Material');
  } else if (contentType === 'problem') {
    pathSegments.push('Practice Material');
  } else if (contentType === 'solution') {
    pathSegments.push('Solutions');
  } else if (contentType === 'exam') {
    pathSegments.push('Exam Materials');
  } else if (contentType === 'syllabus') {
    pathSegments.push('Administration');
  } else if (contentType !== 'other') {
    // Capitalize first letter
    pathSegments.push(contentType.charAt(0).toUpperCase() + contentType.slice(1));
  }
  
  return pathSegments.join('/');
}

/**
 * Generate organized storage path for a file
 */
export function generateOrganizedStoragePath(courseId, fileData, metadata, entityId, filename) {
  const organizedPath = organizeFileByMetadata(fileData, metadata);
  return `courses/${courseId}/organized/${organizedPath}/${entityId}/${filename}`;
}

