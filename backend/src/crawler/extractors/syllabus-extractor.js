/**
 * Syllabus Extractor
 * Extracts syllabus content from Canvas courses
 */

/**
 * Extracts syllabus data from a Canvas syllabus page
 * @param {Object} page - Playwright page object
 * @param {string} url - The syllabus URL
 * @returns {Promise<Object>} - Syllabus data object
 */
async function extractSyllabus(page, url) {
  try {
    // Extract course ID from URL
    const courseIdMatch = url.match(/\/courses\/(\d+)/);
    const courseId = courseIdMatch ? courseIdMatch[1] : null;

    const syllabusData = {
      courseId,
      url,
      extractedAt: new Date().toISOString(),
    };

    // Wait for page content to load
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    await page.waitForSelector('h1, h2, .syllabus, .syllabus-content, main', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000); // Wait for dynamic content

    // Wait for title to be visible
    await page.waitForFunction(() => {
      const h1 = document.querySelector('h1');
      const h2 = document.querySelector('h2');
      if (h1 && h1.textContent.trim() && !h1.textContent.includes('Loading')) return true;
      if (h2 && h2.textContent.trim() && !h2.textContent.includes('Loading')) return true;
      return false;
    }, { timeout: 5000 }).catch(() => {});

    // Extract syllabus title
    const title = await page.evaluate(() => {
      const titleSelectors = [
        'h1',
        'h2',
        '.syllabus-title',
        '.ig-header-title',
        '[data-testid="syllabus-title"]',
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
    syllabusData.title = title;

    // Wait for syllabus content to load
    await page.waitForFunction(() => {
      const contentIndicators = [
        '.syllabus-content',
        '.user_content',
        '.syllabus-body',
        '.syllabus-description',
        '[data-resource-type="syllabus.body"]'
      ];
      
      for (const selector of contentIndicators) {
        const el = document.querySelector(selector);
        if (el) {
          const text = el.textContent.trim();
          return text && text.length > 10 && !text.includes('Loading');
        }
      }
      return false;
    }, { timeout: 8000 }).catch(() => {});
    
    await page.waitForTimeout(1500);

    // Extract syllabus content
    const content = await page.evaluate(() => {
      // Strategy 1: Look for data-resource-type="syllabus.body"
      const syllabusBody = document.querySelector('[data-resource-type="syllabus.body"]');
      if (syllabusBody) {
        const html = syllabusBody.innerHTML.trim();
        const text = syllabusBody.textContent.trim();
        if (html && html.length > 20 && text && text.length > 5 && !text.includes('Loading')) {
          return html;
        }
      }
      
      // Strategy 2: Look for .syllabus-content or .syllabus-body
      const syllabusContent = document.querySelector('.syllabus-content, .syllabus-body, .syllabus-description');
      if (syllabusContent) {
        const html = syllabusContent.innerHTML.trim();
        const text = syllabusContent.textContent.trim();
        if (html && html.length > 20 && text && text.length > 5 && !text.includes('Loading')) {
          return html;
        }
      }
      
      // Strategy 3: Look for .user_content.enhanced
      const userContentEnhanced = document.querySelector('.user_content.enhanced');
      if (userContentEnhanced) {
        const html = userContentEnhanced.innerHTML.trim();
        const text = userContentEnhanced.textContent.trim();
        if (html && html.length > 20 && text && text.length > 5 && !text.includes('Loading')) {
          return html;
        }
      }
      
      // Strategy 4: Try multiple content selectors
      const contentSelectors = [
        '[data-resource-type="syllabus.body"]',
        '.syllabus-content',
        '.syllabus-body',
        '.syllabus-description',
        '.user_content.enhanced',
        '.user_content',
        '.syllabus',
        '[data-testid="syllabus-content"]'
      ];
      
      for (const selector of contentSelectors) {
        const contentEl = document.querySelector(selector);
        if (contentEl) {
          const html = contentEl.innerHTML.trim();
          const text = contentEl.textContent.trim();
          if (html && html.length > 20 && text && text.length > 5 && !text.includes('Loading')) {
            return html;
          }
        }
      }
      
      // Strategy 5: Look in main content area
      const mainContent = document.querySelector('main, .main-content, .content-wrapper, #content, .syllabus');
      if (mainContent) {
        const userContent = mainContent.querySelector('[data-resource-type="syllabus.body"], .syllabus-content, .syllabus-body, .user_content, .syllabus-description');
        if (userContent) {
          const html = userContent.innerHTML.trim();
          const text = userContent.textContent.trim();
          if (html && html.length > 20 && text && text.length > 5 && !text.includes('Loading')) {
            return html;
          }
        }
        
        // Try to get all content from main, filtering out headers/navigation
        const contentClone = mainContent.cloneNode(true);
        contentClone.querySelectorAll('h1, h2, h3, header, .page-header, .spinner, [class*="loading"], nav, .breadcrumbs').forEach(el => el.remove());
        
        const allContent = contentClone.innerHTML.trim();
        const allText = contentClone.textContent.trim();
        if (allContent && allContent.length > 100 && allText && allText.length > 20 && !allText.includes('Loading')) {
          return allContent;
        }
      }
      
      return null;
    });
    syllabusData.content = content;
    syllabusData.contentText = content ? 
      await page.evaluate((html) => {
        const div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent || div.innerText || '';
      }, content) : null;

    // Extract embedded content (images, files, videos, links)
    const embeddedContent = await page.evaluate(() => {
      const images = [];
      document.querySelectorAll('img').forEach(img => {
        if (img.src) images.push({ src: img.src, alt: img.alt });
      });

      const files = [];
      document.querySelectorAll('a[href*="/files/"]').forEach(link => {
        if (link.href && link.textContent.trim()) files.push({ name: link.textContent.trim(), url: link.href });
      });

      const videos = [];
      document.querySelectorAll('iframe[src*="youtube.com"], iframe[src*="vimeo.com"], video').forEach(video => {
        if (video.src) videos.push({ src: video.src });
      });

      const links = [];
      document.querySelectorAll('a:not([href*="/files/"]):not([href*="javascript:"])').forEach(link => {
        const href = link.getAttribute('href');
        const text = link.textContent.trim();
        if (href && text && !href.startsWith('#')) links.push({ text, url: href });
      });

      return { images, files, videos, links };
    });
    syllabusData.embeddedContent = embeddedContent;

    // Extract syllabus metadata
    const metadata = await page.evaluate(() => {
      const meta = {
        lastModified: null,
        isPublished: true
      };

      // Extract last modified date
      const lastModifiedEl = document.querySelector('.last-modified, .syllabus-metadata .modified, [data-testid="last-modified"]');
      if (lastModifiedEl) {
        meta.lastModified = lastModifiedEl.getAttribute('datetime') || 
                           lastModifiedEl.getAttribute('title') ||
                           lastModifiedEl.textContent.trim();
      }

      // Check published status
      const unpublishedEl = document.querySelector('.unpublished, [data-testid="unpublished"]');
      meta.isPublished = !unpublishedEl;

      return meta;
    });
    syllabusData.metadata = metadata;

    // Extract course information if available (often shown on syllabus page)
    const courseInfo = await page.evaluate(() => {
      const info = {
        courseName: null,
        courseCode: null,
        instructor: null,
        term: null
      };

      // Try to find course name
      const courseNameEl = document.querySelector('.course-name, .course-title, [data-testid="course-name"]');
      if (courseNameEl) {
        info.courseName = courseNameEl.textContent.trim();
      }

      // Try to find course code
      const courseCodeEl = document.querySelector('.course-code, .course-number, [data-testid="course-code"]');
      if (courseCodeEl) {
        info.courseCode = courseCodeEl.textContent.trim();
      }

      // Try to find instructor
      const instructorEl = document.querySelector('.instructor, .teacher, [data-testid="instructor"]');
      if (instructorEl) {
        info.instructor = instructorEl.textContent.trim();
      }

      // Try to find term
      const termEl = document.querySelector('.term, .semester, [data-testid="term"]');
      if (termEl) {
        info.term = termEl.textContent.trim();
      }

      return info;
    });
    syllabusData.courseInfo = courseInfo;

    return syllabusData;
  } catch (error) {
    return {
      url,
      error: error.message,
      extractedAt: new Date().toISOString()
    };
  }
}

module.exports = {
  extractSyllabus
};

