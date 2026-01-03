const folderCache = new Map();
const folderFilesCache = new Map();

function buildFolderHtmlUrl(courseId, canvasUrl, fullName) {
  const baseUrl = canvasUrl || 'https://canvas.colorado.edu';
  if (!fullName || fullName === 'course files') {
    return `${baseUrl}/courses/${courseId}/files`;
  }

  const sanitized = fullName.replace(/^course files\/?/i, '');
  if (!sanitized) {
    return `${baseUrl}/courses/${courseId}/files`;
  }

  const encodedPath = sanitized
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `${baseUrl}/courses/${courseId}/files/folder/${encodedPath}`;
}

async function fetchCourseFolders(page, courseId, { canvasUrl, logger } = {}) {
  if (folderCache.has(courseId)) {
    return folderCache.get(courseId);
  }

  const apiResult = await page.evaluate(async (course) => {
    const results = [];
    async function fetchPage(url) {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      if (Array.isArray(data)) {
        results.push(...data);
      } else if (data) {
        results.push(data);
      }
      const linkHeader = response.headers.get('link');
      if (linkHeader) {
        const nextPart = linkHeader.split(',').find((part) => part.includes('rel="next"'));
        if (nextPart) {
          const match = nextPart.match(/<([^>]+)>/);
          if (match && match[1]) {
            await fetchPage(match[1]);
          }
        }
      }
    }
    try {
      await fetchPage(`/api/v1/courses/${course}/folders?per_page=100`);
      return { folders: results };
    } catch (apiError) {
      return { folders: results, error: apiError.message };
    }
  }, courseId);

  if (apiResult?.folders?.length) {
    apiResult.folders = apiResult.folders.map((folder) => {
      if (!folder.html_url) {
        folder.html_url = buildFolderHtmlUrl(courseId, canvasUrl, folder.full_name);
      }
      return folder;
    });
  }

  if (apiResult?.error && logger) {
    logger.debug?.(`Files API lookup failed for course ${courseId}: ${apiResult.error}`);
  }

  folderCache.set(courseId, apiResult);
  return apiResult;
}

async function fetchFilesInFolder(page, folderId, { logger } = {}) {
  const cacheKey = `${folderId}`;
  if (folderFilesCache.has(cacheKey)) {
    return folderFilesCache.get(cacheKey);
  }

  const apiResult = await page.evaluate(async ({ folderId }) => {
    const results = [];
    async function fetchPage(url) {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      if (Array.isArray(data)) {
        results.push(...data);
      } else if (data) {
        results.push(data);
      }
      const linkHeader = response.headers.get('link');
      if (linkHeader) {
        const nextPart = linkHeader.split(',').find((part) => part.includes('rel="next"'));
        if (nextPart) {
          const match = nextPart.match(/<([^>]+)>/);
          if (match && match[1]) {
            await fetchPage(match[1]);
          }
        }
      }
    }
    try {
      await fetchPage(`/api/v1/folders/${folderId}/files?per_page=100`);
      return { files: results };
    } catch (apiError) {
      return { files: results, error: apiError.message };
    }
  }, { folderId });

  if (apiResult?.error && logger) {
    logger.debug?.(`Files API lookup failed for folder ${folderId}: ${apiResult.error}`);
  }

  folderFilesCache.set(cacheKey, apiResult);
  return apiResult;
}

module.exports = {
  fetchCourseFolders,
  fetchFilesInFolder,
  buildFolderHtmlUrl,
};

