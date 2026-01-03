const {
  fetchCourseFolders,
  fetchFilesInFolder
} = require('../utils/files-api.js');

/**
 * File Extractor
 * Extracts file listing and metadata from Canvas file pages
 */

/**
 * Extracts file data from a Canvas files page
 * @param {Object} page - Playwright page object
 * @param {string} url - The files URL
 * @returns {Promise<Object>} - File data object
 */
async function extractFiles(page, url) {
  try {
    // Extract course ID from URL
    const courseIdMatch = url.match(/\/courses\/(\d+)/);
    const courseId = courseIdMatch ? courseIdMatch[1] : null;

    const filesData = {
      courseId,
      url,
      extractedAt: new Date().toISOString(),
      files: [],
      folders: []
    };
    const urlObject = new URL(url);
    const folderMatch = urlObject.pathname.match(/\/files\/folder\/(.+)/);
    const folderSegments = folderMatch
      ? folderMatch[1].split('/').map((segment) => decodeURIComponent(segment))
      : [];
    const baseCourseFilesUrl = `${urlObject.origin}/courses/${courseId}/files`;

    // Wait for file list to load
    await page.waitForSelector('.ef-directory .ef-item-row .ef-name-col__link, .ef-folder-list [role="treeitem"] a', {
      timeout: 10000
    }).catch(() => {});
    await page.waitForFunction(() => {
      return document.querySelectorAll('.ef-directory .ef-item-row .ef-name-col__link').length > 0 ||
             document.querySelectorAll('.ef-folder-list [role="treeitem"] a').length > 0;
    }, { timeout: 15000 }).catch(() => {});

    let rowsReady = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const rowCount = await page.evaluate(() => document.querySelectorAll('.ef-directory .ef-item-row').length);
      if (rowCount > 0) {
        rowsReady = true;
        break;
      }
      await page.waitForTimeout(1000);
    }
    if (!rowsReady) {
      await page.waitForTimeout(500);
    }

    // Extract files and folders
    const fileTree = await page.evaluate(() => {
      const files = [];
      const folders = [];
      const currentPath = [];

      // Extract current folder path
      const breadcrumbEls = document.querySelectorAll('.ef-breadcrumb a, .breadcrumb a');
      breadcrumbEls.forEach(el => {
        const text = el.textContent.trim();
        if (text && text !== 'Files') {
          currentPath.push(text);
        }
      });

      // Extract folders
      const folderElements = Array.from(document.querySelectorAll('.ef-directory .ef-item-row, .ef-folder-list [role="treeitem"]'))
        .filter((row) => {
          const link = row.querySelector('a[href]');
          if (!link) return false;
          const href = link.getAttribute('href') || '';
          return href.includes('/files/folder/') || href.match(/\/files\/?$/);
        });
      folderElements.forEach(folderEl => {
        const folder = {
          name: null,
          path: [...currentPath],
          url: null
        };

        const linkEl = folderEl.querySelector('a');
        if (linkEl) {
          folder.name = linkEl.textContent.trim();
          folder.url = linkEl.getAttribute('href');
          if (folder.url && !folder.url.startsWith('http')) {
            folder.url = new URL(folder.url, window.location.href).href;
          }
        }

        if (folder.name) {
          folders.push(folder);
        }
      });

      // Extract files
      let fileElements = Array.from(document.querySelectorAll('.ef-file-list .ef-item-row, [data-testid="file"]'));
      if (fileElements.length === 0) {
        // Fallback: newer Canvas UI may use generic rows
        fileElements = Array.from(document.querySelectorAll('.ef-item-row, [role="row"]')).filter(row => {
          const link = row.querySelector('a[href*="/files/"]');
          if (!link) return false;
          const href = link.getAttribute('href') || '';
          return href.match(/\/files\/\d+/) && !href.includes('/folder/');
        });
      }
      fileElements.forEach(fileEl => {
        const file = {
          name: null,
          path: [...currentPath],
          url: null,
          size: null,
          type: null,
          modifiedDate: null,
          uploader: null,
          downloadUrl: null
        };

        // Extract file name and URL
        const linkEl = fileEl.querySelector('a');
        if (linkEl) {
          file.name = linkEl.textContent.trim();
          file.url = linkEl.getAttribute('href');
          if (file.url && !file.url.startsWith('http')) {
            file.url = new URL(file.url, window.location.href).href;
          }
        }

        // Extract file ID from URL
        if (file.url) {
          const idMatch = file.url.match(/\/files\/(\d+)/);
          if (idMatch) {
            file.fileId = idMatch[1];
            // Construct download URL
            file.downloadUrl = `${file.url}/download?download_frd=1`;
          }
        }

        // Extract file size
        const sizeEl = fileEl.querySelector('.ef-name-col__text-subtitle, .file-size');
        if (sizeEl) {
          file.size = sizeEl.textContent.trim();
        }

        // Extract file type/extension
        if (file.name) {
          const extMatch = file.name.match(/\.(\w+)$/);
          if (extMatch) {
            file.type = extMatch[1].toLowerCase();
          }
        }

        // Extract modified date
        const dateEl = fileEl.querySelector('.ef-date-col, .modified-date');
        if (dateEl) {
          file.modifiedDate = dateEl.textContent.trim();
        }

        // Extract uploader
        const uploaderEl = fileEl.querySelector('.ef-created-by-col, .uploader');
        if (uploaderEl) {
          file.uploader = uploaderEl.textContent.trim();
        }

        if (file.name) {
          files.push(file);
        }
      });

      return { files, folders, currentPath };
    });

    filesData.files = fileTree.files;
    filesData.folders = fileTree.folders;
    filesData.currentPath = (fileTree.currentPath && fileTree.currentPath.length > 0)
      ? fileTree.currentPath
      : folderSegments;
    filesData.totalFiles = fileTree.files.length;
    filesData.totalFolders = fileTree.folders.length;

    const normalizedFullName = folderSegments.length > 0
      ? `course files/${folderSegments.join('/')}`.toLowerCase()
      : 'course files';

    const humanizeSize = (bytes) => {
      if (typeof bytes !== 'number' || Number.isNaN(bytes)) {
        return null;
      }
      if (bytes >= 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
      }
      if (bytes >= 1024) {
        return `${(bytes / 1024).toFixed(2)} KB`;
      }
      return `${bytes} B`;
    };

    const convertApiFile = (fileRecord) => {
      if (!fileRecord) {
        return null;
      }
      const displayName = fileRecord.display_name || fileRecord.filename || `file-${fileRecord.id}`;
      const htmlUrl = fileRecord.html_url ||
        `${baseCourseFilesUrl}/${fileRecord.id}`;
      const downloadUrl = fileRecord.url ||
        `${urlObject.origin}/files/${fileRecord.id}/download?download_frd=1`;
      return {
        name: displayName,
        path: (filesData.currentPath && filesData.currentPath.length > 0)
          ? [...filesData.currentPath]
          : folderSegments,
        url: htmlUrl,
        size: humanizeSize(fileRecord.size),
        sizeBytes: fileRecord.size || null,
        type: (fileRecord.content_type && fileRecord.content_type.split('/').pop()) ||
          (displayName.match(/\.(\w+)$/)?.[1]?.toLowerCase() || null),
        modifiedDate: fileRecord.updated_at || fileRecord.modified_at || fileRecord.created_at || null,
        uploader: fileRecord.user?.display_name || fileRecord.userName || null,
        downloadUrl,
        fileId: fileRecord.id
      };
    };

    try {
      const apiFolders = await fetchCourseFolders(page, courseId, { canvasUrl: urlObject.origin });
      const foldersList = apiFolders?.folders || [];
      let targetFolder = foldersList.find((folder) => (folder.full_name || '').toLowerCase() === normalizedFullName);
      if (!targetFolder) {
        targetFolder = foldersList.find((folder) => folder.parent_folder_id === null) || null;
      }

      if (targetFolder?.id) {
        filesData.folderId = targetFolder.id;
        filesData.folderFullName = targetFolder.full_name;
        const apiFilesResult = await fetchFilesInFolder(page, targetFolder.id);
        if (apiFilesResult?.files?.length) {
          const convertedFiles = apiFilesResult.files
            .map(convertApiFile)
            .filter(Boolean);
          if (convertedFiles.length > 0) {
            filesData.files = convertedFiles;
            filesData.totalFiles = convertedFiles.length;
            filesData.apiSource = 'folders_api';
          }
        }
        filesData.apiFileCount = apiFilesResult?.files?.length || 0;
      }
    } catch (apiErr) {
      filesData.apiError = apiErr.message;
    }

    // If API still didn't yield anything, fall back to DOM captures
    if (!filesData.files || filesData.files.length === 0) {
      filesData.files = fileTree.files;
      filesData.totalFiles = fileTree.files.length;
    }

    // If there are folders, we might want to navigate into them
    // But for now, we'll just return what's visible on the current page

    return filesData;
  } catch (error) {
    return {
      url,
      error: error.message,
      extractedAt: new Date().toISOString()
    };
  }
}

/**
 * Extracts file metadata from an individual file page
 * @param {Object} page - Playwright page object
 * @param {string} url - The file URL
 * @returns {Promise<Object>} - File metadata object
 */
async function extractFileMetadata(page, url) {
  try {
    const fileIdMatch = url.match(/\/files\/(\d+)/);
    const fileId = fileIdMatch ? fileIdMatch[1] : null;

    const metadata = {
      fileId,
      url,
      extractedAt: new Date().toISOString(),
    };

    // Wait for page to be interactive
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});

    // Extract file metadata using multiple strategies
    const fileData = await page.evaluate(() => {
      const data = {
        name: null,
        size: null,
        type: null,
        modifiedDate: null,
        uploader: null,
        downloadUrl: null
      };

      // Strategy 1: Try to find file name from h2 (Canvas uses h2 for file titles)
      const h2Title = document.querySelector('h2');
      if (h2Title) {
        const h2Text = h2Title.textContent.trim();
        if (h2Text && h2Text.length > 0 && !h2Text.includes('Canvas')) {
          // Clean up: remove course name suffix if present
          data.name = h2Text.split(':').shift().trim();
        }
      }
      
      // Strategy 1b: Try page title if h2 didn't work
      if (!data.name) {
        const pageTitle = document.title;
        if (pageTitle && !pageTitle.includes('Canvas')) {
          // Remove "Canvas" and other common suffixes, also remove course name
          data.name = pageTitle.replace(/\s*-\s*Canvas.*$/, '')
                               .replace(/:\s*[^:]+:\s*[^:]+$/, '') // Remove course name pattern
                               .trim();
        }
      }

      // Strategy 2: Look for file name in various Canvas structures
      if (!data.name) {
        // Try common Canvas file page selectors
        const nameSelectors = [
          'h1',
          '.file-name',
          '.ef-file-name',
          '[data-testid="file-name"]',
          '.file-header h1',
          '.file-details h1',
          '.file-preview-header h1',
          '.ef-file-preview-header h1',
          '.file-title',
          '.ef-file-title'
        ];
        
        for (const selector of nameSelectors) {
          const el = document.querySelector(selector);
          if (el) {
            const text = el.textContent.trim();
            if (text && text.length > 0 && !text.includes('Canvas')) {
              data.name = text;
              break;
            }
          }
        }
      }

      // Strategy 3: Extract from download link text (includes size!)
      const downloadLink = document.querySelector('a[href*="/download"], a[download]');
      if (downloadLink) {
        const downloadText = downloadLink.textContent.trim() || downloadLink.getAttribute('download') || downloadLink.getAttribute('title');
        if (downloadText && downloadText.length > 0) {
          // Download link often contains "Download filename.pdf (1.6 MB)"
          // Extract filename and size
          const downloadMatch = downloadText.match(/Download\s+(.+?)\s*\(([^)]+)\)/i) || 
                               downloadText.match(/(.+?)\s*\(([^)]+)\)/);
          if (downloadMatch) {
            if (!data.name) {
              data.name = downloadMatch[1].trim();
            }
            if (!data.size) {
              data.size = downloadMatch[2].trim();
            }
          } else if (!data.name) {
            // Just use the text as filename if no pattern match
            data.name = downloadText.replace(/^Download\s+/i, '').trim();
          }
        }
        if (!data.downloadUrl) {
          data.downloadUrl = downloadLink.getAttribute('href');
        }
      }

      // Strategy 4: Extract from URL if it contains filename
      if (!data.name) {
        const urlParams = new URLSearchParams(window.location.search);
        const filename = urlParams.get('filename') || urlParams.get('name');
        if (filename) {
          data.name = decodeURIComponent(filename);
        }
      }

      // Extract file size - try multiple selectors
      const sizeSelectors = [
        '.file-size',
        '.ef-file-size',
        '[data-testid="file-size"]',
        '.file-details .file-size',
        '.file-info .file-size',
        '.file-metadata .file-size',
        '.ef-file-details .ef-file-size'
      ];

      for (const selector of sizeSelectors) {
        const sizeEl = document.querySelector(selector);
        if (sizeEl) {
          const sizeText = sizeEl.textContent.trim();
          // Look for size patterns like "1.5 MB", "500 KB", etc.
          const sizeMatch = sizeText.match(/([\d.]+)\s*(KB|MB|GB|bytes?)/i);
          if (sizeMatch || (sizeText.length < 50 && sizeText.match(/[\d.]/))) {
            data.size = sizeText;
            break;
          }
        }
      }

      // Extract modified date - try multiple selectors
      const dateSelectors = [
        '.modified-date',
        '.file-modified',
        '[data-testid="modified-date"]',
        '.file-details .modified',
        '.file-info .modified',
        '.file-metadata .modified',
        '.ef-file-details .ef-file-modified',
        'time[datetime]',
        '[title*="Modified"], [title*="Updated"]'
      ];

      for (const selector of dateSelectors) {
        const dateEl = document.querySelector(selector);
        if (dateEl) {
          const dateText = dateEl.getAttribute('datetime') || 
                          dateEl.getAttribute('title') || 
                          dateEl.textContent.trim();
          if (dateText && dateText.length > 0) {
            data.modifiedDate = dateText;
            break;
          }
        }
      }

      // Extract uploader/author
      const uploaderSelectors = [
        '.uploader',
        '.file-uploader',
        '.file-author',
        '[data-testid="uploader"]',
        '.file-details .uploader',
        '.file-info .uploader',
        '.file-metadata .uploader',
        '.ef-file-details .ef-file-uploader',
        '.created-by',
        '.file-created-by'
      ];

      for (const selector of uploaderSelectors) {
        const uploaderEl = document.querySelector(selector);
        if (uploaderEl) {
          const uploaderText = uploaderEl.textContent.trim();
          if (uploaderText && uploaderText.length < 100) {
            data.uploader = uploaderText;
            break;
          }
        }
      }

      // Extract download URL if not already found
      if (!data.downloadUrl) {
        const downloadSelectors = [
          'a[href*="/download"]',
          'a[download]',
          '.download-link',
          '.file-download',
          '[data-testid="download-link"]',
          'button[data-download-url]'
        ];

        for (const selector of downloadSelectors) {
          const downloadEl = document.querySelector(selector);
          if (downloadEl) {
            data.downloadUrl = downloadEl.getAttribute('href') || 
                              downloadEl.getAttribute('data-download-url') ||
                              (downloadEl.closest('a') ? downloadEl.closest('a').getAttribute('href') : null);
            if (data.downloadUrl) break;
          }
        }
      }

      // Construct download URL from file ID if we have it
      if (!data.downloadUrl && window.location.pathname.match(/\/files\/(\d+)/)) {
        const fileId = window.location.pathname.match(/\/files\/(\d+)/)[1];
        data.downloadUrl = `${window.location.origin}${window.location.pathname}/download?download_frd=1`;
      }

      // Extract file type from name or content type
      if (data.name) {
        const extMatch = data.name.match(/\.(\w+)(?:\?|$)/);
        if (extMatch) {
          data.type = extMatch[1].toLowerCase();
        }
      }

      // Try to get content type from meta tags or headers
      if (!data.type) {
        const contentType = document.querySelector('meta[http-equiv="Content-Type"]');
        if (contentType) {
          const content = contentType.getAttribute('content');
          if (content) {
            const mimeMatch = content.match(/\/(\w+)/);
            if (mimeMatch) {
              data.type = mimeMatch[1];
            }
          }
        }
      }

      return data;
    });

    // Merge extracted data
    metadata.name = fileData.name;
    metadata.size = fileData.size;
    metadata.type = fileData.type;
    metadata.modifiedDate = fileData.modifiedDate;
    metadata.uploader = fileData.uploader;
    metadata.downloadUrl = fileData.downloadUrl || `${url.replace(/\?.*$/, '')}/download?download_frd=1`;

    // If we still don't have a name, try extracting from iframe or canvas preview
    if (!metadata.name) {
      const iframeName = await page.evaluate(() => {
        const iframe = document.querySelector('iframe[src*="/files/"]');
        if (iframe) {
          const src = iframe.getAttribute('src');
          const match = src.match(/\/files\/\d+\/([^\/\?]+)/);
          if (match) {
            return decodeURIComponent(match[1]);
          }
        }
        return null;
      });
      if (iframeName) {
        metadata.name = iframeName;
      }
    }

    return metadata;
  } catch (error) {
    return {
      url,
      error: error.message,
      extractedAt: new Date().toISOString()
    };
  }
}

module.exports = {
  extractFiles,
  extractFileMetadata
};
