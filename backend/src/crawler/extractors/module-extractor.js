/**
 * Module Extractor
 * Extracts module structure and items from Canvas module pages
 */

/**
 * Extracts module data from a Canvas modules page
 * @param {Object} page - Playwright page object
 * @param {string} url - The modules URL
 * @returns {Promise<Object>} - Module data object
 */
async function extractModules(page, url) {
  try {
    // Extract course ID from URL
    const courseIdMatch = url.match(/\/courses\/(\d+)/);
    const courseId = courseIdMatch ? courseIdMatch[1] : null;

    let pageOrigin = '';
    try {
      pageOrigin = new URL(url).origin;
    } catch {
      pageOrigin = '';
    }

    const modulesData = {
      courseId,
      url,
      extractedAt: new Date().toISOString(),
      modules: [],
      moduleFiles: []
    };

    // Extract all modules with improved selectors
    const modules = await page.evaluate(() => {
      const modules = [];
      // Try multiple selectors for modules
      const moduleSelectors = [
        '.context_module',
        '[data-testid="module"]',
        '.ig-list .context_module',
        '.modules .context_module',
        '.module'
      ];

      let moduleElements = [];
      for (const selector of moduleSelectors) {
        moduleElements = document.querySelectorAll(selector);
        if (moduleElements.length > 0) break;
      }
      
      moduleElements.forEach((moduleEl, index) => {
        const module = {
          index: index + 1,
          id: moduleEl.getAttribute('id') || 
              moduleEl.getAttribute('data-module-id') || 
              moduleEl.getAttribute('data-id') ||
              null,
          items: []
        };

        // Extract module name - try multiple selectors
        const nameSelectors = [
          '.ig-header-title',
          '.module-title',
          'h2',
          '.context_module_header .ig-header-title',
          '.context_module_header h2',
          '[data-testid="module-title"]'
        ];

        for (const selector of nameSelectors) {
          const nameEl = moduleEl.querySelector(selector);
          if (nameEl) {
            module.name = nameEl.textContent.trim();
            break;
          }
        }

        // Extract module description
        const descEl = moduleEl.querySelector('.module-description, .ig-description');
        module.description = descEl ? descEl.textContent.trim() : null;

        // Extract prerequisites
        const prereqEl = moduleEl.querySelector('.prerequisites, [data-testid="prerequisites"]');
        module.prerequisites = prereqEl ? prereqEl.textContent.trim() : null;

        // Extract completion requirements
        const reqEl = moduleEl.querySelector('.completion-requirements, [data-testid="completion-requirements"]');
        module.completionRequirements = reqEl ? reqEl.textContent.trim() : null;

        // Extract module items
        const itemElements = moduleEl.querySelectorAll('.ig-list .ig-list-item, .module-item, [data-testid="module-item"]');
        itemElements.forEach((itemEl, itemIndex) => {
          const item = {};

          // Extract item type
          const typeIcon = itemEl.querySelector('.ig-type-icon, .type-icon');
          if (typeIcon) {
            const classList = Array.from(typeIcon.classList);
            if (classList.some(c => c.includes('assignment'))) item.type = 'assignment';
            else if (classList.some(c => c.includes('quiz'))) item.type = 'quiz';
            else if (classList.some(c => c.includes('discussion'))) item.type = 'discussion';
            else if (classList.some(c => c.includes('page'))) item.type = 'page';
            else if (classList.some(c => c.includes('file'))) item.type = 'file';
            else item.type = 'other';
          }

          // Extract item title and URL
          const linkEl = itemEl.querySelector('a');
          if (linkEl) {
            item.title = linkEl.textContent.trim();
            item.url = linkEl.getAttribute('href');
            if (item.url && !item.url.startsWith('http')) {
              item.url = new URL(item.url, window.location.href).href;
            }
          }

          // Extract item ID from URL
          if (item.url) {
            const idMatch = item.url.match(/\/(assignments|quizzes|discussion_topics|pages|files)\/(\d+)/);
            if (idMatch) {
              item.itemId = idMatch[2];
            }
          }

          // Extract completion status
          const completedEl = itemEl.querySelector('.ig-list-item__content .icon-check, .completed');
          item.isCompleted = !!completedEl;

          // Extract locked status
          const lockedEl = itemEl.querySelector('.locked, .icon-lock');
          item.isLocked = !!lockedEl;

          // Extract points (if applicable)
          const pointsEl = itemEl.querySelector('.points, .ig-list-item__content .points');
          if (pointsEl) {
            const pointsText = pointsEl.textContent.trim();
            const match = pointsText.match(/(\d+(?:\.\d+)?)/);
            item.points = match ? parseFloat(match[1]) : null;
          }

          // Add location metadata - where this item was extracted from
          item.location = {
            source: 'module',
            moduleName: module.name || null,
            moduleId: module.id || null,
            moduleIndex: module.index || null,
            itemIndex: itemIndex + 1,
            moduleUrl: window.location.href
          };

          if (item.title || item.url) {
            module.items.push(item);
          }
        });

        if (module.name) {
          modules.push(module);
        }
      });

      return modules;
    });

    modulesData.modules = modules;
    if (courseId) {
      try {
        const apiModules = await page.evaluate(async (course) => {
          const collected = [];
          async function fetchPage(apiUrl) {
            const response = await fetch(apiUrl, { headers: { Accept: 'application/json' } });
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            if (Array.isArray(data)) {
              collected.push(...data);
            }
            const linkHeader = response.headers.get('link');
            if (linkHeader) {
              const nextPart = linkHeader.split(',').find((part) => part.includes('rel=\"next\"'));
              if (nextPart) {
                const match = nextPart.match(/<([^>]+)>/);
                if (match && match[1]) {
                  await fetchPage(match[1]);
                }
              }
            }
          }
          await fetchPage(`/api/v1/courses/${course}/modules?include[]=items&include[]=content_details&per_page=100`);
          return collected;
        }, courseId);

        if (Array.isArray(apiModules) && apiModules.length > 0) {
          const moduleFiles = [];
          apiModules.forEach((module) => {
            if (!module || !Array.isArray(module.items)) return;
            module.items.forEach((item) => {
              if (!item) return;
              const itemType = item.type || item.content_type || '';
              const isFileItem = itemType.toLowerCase() === 'file';
              if (!isFileItem) return;

              const contentDetails = item.content_details || {};
              let fileUrl = contentDetails.html_url || item.html_url || item.url || null;
              if (fileUrl && !fileUrl.startsWith('http')) {
                try {
                  fileUrl = new URL(fileUrl, url).href;
                } catch {
                  // keep as-is
                }
              }
              let downloadUrl = contentDetails.url || contentDetails.download_url || null;
              if (!downloadUrl && fileUrl && fileUrl.includes('/files/')) {
                downloadUrl = `${fileUrl.replace(/\?.*$/, '')}/download?download_frd=1`;
              }

              const fileId = item.content_id || contentDetails.id || null;
              if (!downloadUrl && fileId && pageOrigin) {
                downloadUrl = `${pageOrigin}/files/${fileId}/download?download_frd=1`;
              }
              if (downloadUrl && downloadUrl.startsWith('/')) {
                downloadUrl = `${pageOrigin}${downloadUrl}`;
              }

              moduleFiles.push({
                courseId,
                moduleId: module.id,
                moduleName: module.name,
                modulePosition: module.position,
                moduleState: module.workflow_state || module.state || null,
                moduleItemId: item.id,
                moduleItemTitle: item.title || contentDetails.display_name || null,
                moduleItemType: itemType,
                moduleItemPosition: item.position,
                moduleItemUrl: item.html_url || item.url || null,
                fileId,
                fileName: contentDetails.display_name || item.title || null,
                fileUrl,
                downloadUrl,
                published: item.published,
                indent: item.indent || 0,
                completionRequirement: item.completion_requirement || null,
                updatedAt: item.updated_at || module.updated_at || null
              });
            });
          });
          modulesData.moduleFiles = moduleFiles;
        }
      } catch (apiError) {
        modulesData.moduleFilesError = apiError.message;
      }
    }

    modulesData.totalModules = modules.length;
    modulesData.totalItems = modules.reduce((sum, m) => sum + m.items.length, 0);

    return modulesData;
  } catch (error) {
    return {
      url,
      error: error.message,
      extractedAt: new Date().toISOString()
    };
  }
}

module.exports = {
  extractModules
};

