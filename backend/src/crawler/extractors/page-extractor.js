/**
 * Page Extractor
 * Extracts course pages with full HTML content from Canvas
 */

/**
 * Extracts page data from a Canvas page
 * @param {Object} page - Playwright page object
 * @param {string} url - The page URL
 * @param {Object} options - Optional extraction options
 * @param {Object} options.locationContext - Location context (module info, folder, etc.)
 * @returns {Promise<Object>} - Page data object
 */
async function extractPage(page, url, options = {}) {
  try {
    // Extract course ID and page slug from URL
    const courseIdMatch = url.match(/\/courses\/(\d+)/);
    const courseId = courseIdMatch ? courseIdMatch[1] : null;
    
    const pageSlugMatch = url.match(/\/pages\/([^\/\?]+)/);
    const pageSlug = pageSlugMatch ? pageSlugMatch[1] : null;

    const pageData = {
      courseId,
      pageSlug,
      url,
      extractedAt: new Date().toISOString(),
    };

    // Wait for page content to load
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    await page.waitForSelector('h1, h2, .page-content, .user_content, main', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000); // Wait for dynamic content

    // Wait for title to be visible (not just "Loading")
    await page.waitForFunction(() => {
      const h1 = document.querySelector('h1');
      const h2 = document.querySelector('h2');
      if (h1 && h1.textContent.trim() && !h1.textContent.includes('Loading')) return true;
      if (h2 && h2.textContent.trim() && !h2.textContent.includes('Loading')) return true;
      return false;
    }, { timeout: 5000 }).catch(() => {});

    // Extract page title
    const title = await page.evaluate(() => {
      const titleSelectors = [
        'h1',
        'h2',
        '.page-title',
        '.ig-header-title',
        '[data-testid="page-title"]',
        'header h1, header h2'
      ];
      
      for (const selector of titleSelectors) {
        const titleEl = document.querySelector(selector);
        if (titleEl) {
          const text = titleEl.textContent.trim();
          if (text && text.length > 0 && !text.includes('Loading') && text !== 'Canvas') {
            return text;
          }
        }
      }
      
      return null;
    });
    pageData.title = title;

    // Wait for page content to load
    await page.waitForFunction(() => {
      const userContent = document.querySelector('.user_content, .page-content');
      if (userContent) {
        const text = userContent.textContent.trim();
        return text && text.length > 10 && !text.includes('Loading');
      }
      return false;
    }, { timeout: 5000 }).catch(() => {});

    // Extract page content/body
    const content = await page.evaluate(() => {
      const contentSelectors = [
        '.user_content',
        '.page-content',
        '[data-testid="page-content"]',
        '.content',
        '.page-body',
        '.ig-details__content'
      ];
      
      for (const selector of contentSelectors) {
        const contentEl = document.querySelector(selector);
        if (contentEl) {
          const html = contentEl.innerHTML.trim();
          const text = contentEl.textContent.trim();
          if (html && html.length > 50 && text && text.length > 10 && !text.includes('Loading')) {
            return html;
          }
        }
      }
      
      // Try to find content in main area
      const mainContent = document.querySelector('main, .main-content, .content-wrapper, #content');
      if (mainContent) {
        const userContent = mainContent.querySelector('.user_content, .page-content, .content');
        if (userContent) {
          const html = userContent.innerHTML.trim();
          const text = userContent.textContent.trim();
          if (html && html.length > 50 && text && text.length > 10 && !text.includes('Loading')) {
            return html;
          }
        }
        // Get all content except headers
        const contentClone = mainContent.cloneNode(true);
        contentClone.querySelectorAll('h1, h2, h3, header, .page-header, .spinner, [class*="loading"]').forEach(el => el.remove());
        const html = contentClone.innerHTML.trim();
        const text = contentClone.textContent.trim();
        if (html && html.length > 50 && text && text.length > 10 && !text.includes('Loading')) {
          return html;
        }
      }
      
      return null;
    });
    pageData.content = content;
    pageData.contentText = content ? 
      await page.evaluate((html) => {
        const div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent || div.innerText || '';
      }, content) : null;

    // Extract embedded content (images, files, videos)
    const embeddedContent = await page.evaluate(() => {
      const embedded = {
        images: [],
        files: [],
        videos: [],
        links: []
      };

      // Extract images
      const images = document.querySelectorAll('.user_content img, .page-content img, img[src]');
      images.forEach(img => {
        const src = img.getAttribute('src');
        const alt = img.getAttribute('alt') || '';
        if (src && !src.includes('data:')) {
          embedded.images.push({
            src: src.startsWith('http') ? src : new URL(src, window.location.href).href,
            alt: alt
          });
        }
      });

      // Extract file links
      const fileLinks = document.querySelectorAll('.user_content a[href*="/files/"], .page-content a[href*="/files/"]');
      fileLinks.forEach(link => {
        const href = link.getAttribute('href');
        const text = link.textContent.trim();
        if (href) {
          embedded.files.push({
            url: href.startsWith('http') ? href : new URL(href, window.location.href).href,
            name: text || href.split('/').pop()
          });
        }
      });

      // Extract video embeds
      const videos = document.querySelectorAll('.user_content video, .page-content video, iframe[src*="youtube"], iframe[src*="vimeo"]');
      videos.forEach(video => {
        const src = video.getAttribute('src') || video.getAttribute('data-src');
        if (src) {
          embedded.videos.push({
            url: src.startsWith('http') ? src : new URL(src, window.location.href).href,
            type: video.tagName.toLowerCase()
          });
        }
      });

      // Extract external links
      const links = document.querySelectorAll('.user_content a[href^="http"], .page-content a[href^="http"]');
      links.forEach(link => {
        const href = link.getAttribute('href');
        const text = link.textContent.trim();
        if (href && !href.includes(window.location.hostname)) {
          embedded.links.push({
            url: href,
            text: text
          });
        }
      });

      return embedded;
    });
    pageData.embeddedContent = embeddedContent;

    // Extract page metadata (if available)
    const metadata = await page.evaluate(() => {
      const meta = {
        lastModified: null,
        author: null,
        published: null
      };

      // Try to find last modified date
      const modifiedEl = document.querySelector('.last-modified, .page-modified, [data-testid="last-modified"]');
      if (modifiedEl) {
        meta.lastModified = modifiedEl.textContent.trim() || modifiedEl.getAttribute('datetime');
      }

      // Try to find author
      const authorEl = document.querySelector('.page-author, .author, [data-testid="author"]');
      if (authorEl) {
        meta.author = authorEl.textContent.trim();
      }

      // Check if published
      const unpublishedEl = document.querySelector('.unpublished, [data-testid="unpublished"]');
      meta.published = !unpublishedEl;

      return meta;
    });
    pageData.metadata = metadata;

    // Extract location metadata - where this page was found
    const locationData = await page.evaluate((locationContext) => {
      const location = {
        source: 'standalone', // default
        moduleName: null,
        moduleId: null,
        moduleIndex: null,
        folder: null,
        breadcrumbs: []
      };

      // If location context was provided (e.g., from module extraction)
      if (locationContext) {
        location.source = 'module';
        location.moduleName = locationContext.moduleName || null;
        location.moduleId = locationContext.moduleId || null;
        location.moduleIndex = locationContext.moduleIndex || null;
      }

      // Try to detect if page is in a folder by checking breadcrumbs
      const breadcrumbEls = document.querySelectorAll('.breadcrumbs a, nav[aria-label="breadcrumbs"] a, .breadcrumb a');
      if (breadcrumbEls.length > 0) {
        breadcrumbEls.forEach(el => {
          const text = el.textContent.trim();
          if (text && text !== 'Home' && text !== 'Courses' && !text.includes('Page')) {
            location.breadcrumbs.push(text);
          }
        });
      }

      // Try to detect folder structure from page navigation or sidebar
      const folderEl = document.querySelector('.folder, .file-tree, [data-testid="folder"]');
      if (folderEl) {
        location.folder = folderEl.textContent.trim();
      }

      // Check if page is part of a module by looking for module indicators
      const moduleIndicator = document.querySelector('.context_module, [data-module-id], .module-context');
      if (moduleIndicator && !locationContext) {
        location.source = 'module';
        const moduleNameEl = moduleIndicator.querySelector('.ig-header-title, .module-title, h2');
        if (moduleNameEl) {
          location.moduleName = moduleNameEl.textContent.trim();
        }
        location.moduleId = moduleIndicator.getAttribute('data-module-id') || 
                           moduleIndicator.getAttribute('id') || 
                           null;
      }

      // Check for file/folder navigation context
      const fileNav = document.querySelector('.file-navigation, .files-list, [data-testid="file-navigation"]');
      if (fileNav) {
        location.source = 'files';
        const folderPath = fileNav.getAttribute('data-folder-path') || 
                          fileNav.getAttribute('aria-label') ||
                          null;
        if (folderPath) {
          location.folder = folderPath;
        }
      }

      return location;
    }, options.locationContext || null);
    
    pageData.location = locationData;

    return pageData;
  } catch (error) {
    return {
      url,
      error: error.message,
      extractedAt: new Date().toISOString()
    };
  }
}

module.exports = {
  extractPage
};
