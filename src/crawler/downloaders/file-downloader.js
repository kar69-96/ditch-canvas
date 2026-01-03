/**
 * File Downloader
 * Downloads files from Canvas using Playwright
 */

const fs = require('fs');
const path = require('path');

// Use node-fetch if fetch is not available (Node < 18) for fallback utilities
let fetch;
try {
  if (typeof globalThis.fetch === 'function') {
    fetch = globalThis.fetch;
  } else {
    fetch = require('node-fetch');
  }
} catch (e) {
  fetch = globalThis.fetch;
  if (!fetch) {
    throw new Error('fetch is not available. Please use Node.js 18+ or install node-fetch');
  }
}

/**
 * Downloads a file from a Canvas URL
 * @param {Object} page - Playwright page object
 * @param {string} url - The file URL to download (must be absolute)
 * @param {string} downloadPath - The path where the file should be saved
 * @param {Object} options - Download options
 * @returns {Promise<Object>} - Download result with file path and metadata
 */
async function downloadFile(page, url, downloadPath, options = {}) {
  try {
    const { timeout = 60000, retries = 3 } = options;
    
    // Ensure URL is absolute
    if (url.startsWith('/')) {
      // Get base URL from current page context
      const currentUrl = page.url();
      const baseUrl = new URL(currentUrl).origin;
      url = `${baseUrl}${url}`;
    }

    // Ensure download directory exists
    const dir = path.dirname(downloadPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Use the filename from downloadPath if provided
    const expectedFilename = path.basename(downloadPath);

    const requestContext = page.request || (page.context && page.context().request);
    if (!requestContext) {
      throw new Error('Playwright request context unavailable for downloads');
    }

    const response = requestContext.fetch
      ? await requestContext.fetch(url, { timeout })
      : await requestContext.get(url, { timeout });

    if (!response.ok()) {
      if (response.status() === 401) {
        const cookies = await page.context().cookies();
        const cookieNames = cookies.map((c) => `${c.name}@${c.domain}`);
        console.log(`[downloadFile] HTTP 401 for ${url} with cookies: ${cookieNames.join(', ')}`);
      }
      throw new Error(`HTTP ${response.status()}: ${response.statusText()}`);
    }

    // Get filename from Content-Disposition or use provided filename
    let filename = expectedFilename;
    const headers = response.headers();
    const contentDisposition = headers['content-disposition'] || headers['Content-Disposition'];
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (filenameMatch) {
        filename = filenameMatch[1].replace(/['"]/g, '');
      }
    }

    // If still no filename, extract from URL
    if (!filename || filename === 'download') {
      const urlMatch = url.match(/\/([^\/]+\.\w+)(?:\?|$)/);
      filename = urlMatch ? urlMatch[1] : `file_${Date.now()}.bin`;
    }

    // Sanitize filename
    filename = sanitizeFilename(filename);

    // Construct full download path
    const fullPath = path.join(dir, filename);

    // Get file buffer
    const fileBuffer = await response.body();

    // Write file
    fs.writeFileSync(fullPath, fileBuffer);


    // Get file stats
    const stats = fs.statSync(fullPath);

    return {
      success: true,
      filePath: fullPath,
      filename,
      size: stats.size,
      url,
      downloadedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      url,
      downloadedAt: new Date().toISOString()
    };
  }
}

/**
 * Downloads a file using direct fetch (alternative method)
 * @param {string} url - The file URL to download
 * @param {string} downloadPath - The path where the file should be saved
 * @param {Array} cookies - Cookies for authentication
 * @param {Object} options - Download options
 * @returns {Promise<Object>} - Download result
 */
async function downloadFileWithFetch(url, downloadPath, cookies, options = {}) {
  try {
    const { timeout = 30000 } = options;

    // Ensure download directory exists
    const dir = path.dirname(downloadPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Convert cookies to cookie header string
    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // Fetch the file
    const response = await fetch(url, {
      headers: {
        'Cookie': cookieString,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(timeout)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Get filename from Content-Disposition header or URL
    let filename = null;
    const contentDisposition = response.headers.get('content-disposition');
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (filenameMatch) {
        filename = filenameMatch[1].replace(/['"]/g, '');
      }
    }

    if (!filename) {
      const urlMatch = url.match(/\/([^\/]+\.\w+)(?:\?|$)/);
      filename = urlMatch ? urlMatch[1] : `file_${Date.now()}.bin`;
    }

    // Sanitize filename
    filename = sanitizeFilename(filename);

    // Construct full download path
    const fullPath = path.join(dir, filename);

    // Get file buffer
    const buffer = await response.arrayBuffer();
    const fileBuffer = Buffer.from(buffer);

    // Write file
    fs.writeFileSync(fullPath, fileBuffer);

    // Get file stats
    const stats = fs.statSync(fullPath);

    return {
      success: true,
      filePath: fullPath,
      filename,
      size: stats.size,
      url,
      downloadedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      url,
      downloadedAt: new Date().toISOString()
    };
  }
}

/**
 * Sanitizes a filename to remove invalid characters
 * @param {string} filename - The filename to sanitize
 * @returns {string} - Sanitized filename
 */
function sanitizeFilename(filename) {
  // Remove or replace invalid characters
  return filename
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .trim();
}

/**
 * Organizes file path by content type
 * @param {string} pathPrefix - The path prefix (e.g., "extraction-2025-01-15T10-30-45/courses/123456")
 * @param {string} contentType - The content type (assignments, files, pages, etc.)
 * @param {string} itemId - Optional item ID (assignment ID, page slug, etc.)
 * @param {string} filename - The filename
 * @returns {string} - Organized file path
 */
function organizeDownloadPath(pathPrefix, contentType, itemId = null, filename = null, options = {}) {
  const { folderSegments = [] } = options;
  // Use CRAWLEE_STORAGE_DIR (which is set to the extraction folder) + pathPrefix for downloads
  // Structure: {CRAWLEE_STORAGE_DIR}/courses/{courseId}/downloads/{contentType}/{itemId}/{filename}
  // CRAWLEE_STORAGE_DIR is already set to the extraction folder (e.g., storage/datasets/extraction-{timestamp})
  const storageDir = process.env.CRAWLEE_STORAGE_DIR || path.join(__dirname, '..', '..', '..', 'storage', 'datasets');
  const baseDir = path.join(storageDir, pathPrefix, 'downloads', contentType);

  let subPath = [];
  if (Array.isArray(folderSegments) && folderSegments.length > 0) {
    subPath = folderSegments
      .filter(Boolean)
      .map((segment) => sanitizeFilename(String(segment)));
  } else if (itemId) {
    subPath = [String(itemId)];
  }

  const finalDir = subPath.length > 0 ? path.join(baseDir, ...subPath) : baseDir;
  return path.join(finalDir, filename || '');
}

module.exports = {
  downloadFile,
  downloadFileWithFetch,
  sanitizeFilename,
  organizeDownloadPath
};
