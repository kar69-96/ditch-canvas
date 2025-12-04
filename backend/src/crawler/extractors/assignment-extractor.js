/**
 * Assignment Extractor
 * Extracts detailed assignment information from Canvas assignment pages
 */

/**
 * Extracts assignment data from a Canvas assignment page
 * @param {Object} page - Playwright page object
 * @param {string} url - The assignment URL
 * @returns {Promise<Object>} - Assignment data object
 */
async function extractAssignment(page, url, options = {}) {
  try {
    // Extract assignment ID from URL
    const assignmentIdMatch = url.match(/\/assignments\/(\d+)/);
    const assignmentId = assignmentIdMatch ? assignmentIdMatch[1] : null;

    // Extract course ID from URL
    const courseIdMatch = url.match(/\/courses\/(\d+)/);
    const courseId = courseIdMatch ? courseIdMatch[1] : null;

    const assignmentData = {
      assignmentId,
      courseId,
      url,
      extractedAt: new Date().toISOString(),
    };

    // Remove DOM regions that could contain student submissions, feedback, or grades
    const removedSensitiveNodes = await scrubSensitiveSubmissionElements(page);
    if (removedSensitiveNodes > 0) {
      console.log(`⚠️  FERPA safeguard: removed ${removedSensitiveNodes} student-submission node(s) before extracting ${url}`);
    }

    // Wait for title to be visible (not just "Loading")
    await page.waitForFunction(() => {
      const h2 = document.querySelector('h2');
      const h1 = document.querySelector('h1');
      if (h2 && h2.textContent.trim() && !h2.textContent.includes('Loading')) return true;
      if (h1 && h1.textContent.trim() && !h1.textContent.includes('Loading')) return true;
      return false;
    }, { timeout: 5000 }).catch(() => {});

    // Extract assignment title - h2 is the primary selector for Canvas
    const title = await page.evaluate(() => {
      // Try h2 first (most common in Canvas)
      const titleSelectors = [
        'h2',
        'h1',
        '.assignment-title',
        '[data-testid="assignment-title"]',
        '.ig-header-title',
        '.page-title',
        'header h1, header h2',
        '.page-header h1, .page-header h2'
      ];
      
      for (const selector of titleSelectors) {
        const titleEl = document.querySelector(selector);
        if (titleEl) {
          const text = titleEl.textContent.trim();
          // Skip loading states and empty text
          if (text && text.length > 0 && !text.includes('Loading') && text !== 'Canvas') {
            return text;
          }
        }
      }
      
      // Fallback: try to find title in page structure
      const pageHeader = document.querySelector('.page-header, .header-content, .ig-header');
      if (pageHeader) {
        const headerTitle = pageHeader.querySelector('h1, h2, h3, .ig-header-title');
        if (headerTitle) {
          const text = headerTitle.textContent.trim();
          if (text && !text.includes('Loading') && text !== 'Canvas') {
            return text;
          }
        }
      }
      
      return null;
    });
    assignmentData.title = title;

    // Wait for description content to load (not just "Loading")
    await page.waitForFunction(() => {
      const userContent = document.querySelector('.user_content');
      if (userContent) {
        const text = userContent.textContent.trim();
        return text && text.length > 10 && !text.includes('Loading');
      }
      return false;
    }, { timeout: 5000 }).catch(() => {});

    // Extract assignment description/instructions - improved HTML extraction
    const description = await page.evaluate(() => {
      // Try multiple selectors for description
      const descSelectors = [
        '.assignment-description',
        '.user_content',
        '[data-testid="assignment-description"]',
        '.description',
        '.assignment-details',
        '.assignment-instructions',
        '.ig-details__content',
        '.content',
        '.assignment-content'
      ];
      
      for (const selector of descSelectors) {
        const descEl = document.querySelector(selector);
        if (descEl) {
          const html = descEl.innerHTML.trim();
          const text = descEl.textContent.trim();
          // Skip loading states and minimal content
          if (html && html.length > 50 && text && text.length > 10 && !text.includes('Loading')) {
            return html;
          }
        }
      }
      
      // Try to find description in main content area
      const mainContent = document.querySelector('main, .main-content, .content-wrapper, #content');
      if (mainContent) {
        // Look for user_content or description divs within main content
        const userContent = mainContent.querySelector('.user_content, .description, .assignment-description');
        if (userContent) {
          const html = userContent.innerHTML.trim();
          const text = userContent.textContent.trim();
          if (html && html.length > 50 && text && text.length > 10 && !text.includes('Loading')) {
            return html;
          }
        }
        // If no specific description element, get all content except header/title
        const contentClone = mainContent.cloneNode(true);
        // Remove header elements and loading spinners
        contentClone.querySelectorAll('h1, h2, h3, header, .page-header, .spinner, [class*="loading"]').forEach(el => el.remove());
        const html = contentClone.innerHTML.trim();
        const text = contentClone.textContent.trim();
        if (html && html.length > 50 && text && text.length > 10 && !text.includes('Loading')) {
          return html;
        }
      }
      
      return null;
    });
    assignmentData.description = description;
    assignmentData.descriptionText = description ? 
      await page.evaluate((html) => {
        const div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent || div.innerText || '';
      }, description) : null;

    // Extract points - improved selectors
    const points = await page.evaluate(() => {
      // Try multiple selectors for points
      const pointsSelectors = [
        '.points_possible',
        '[data-testid="points-possible"]',
        '.assignment-points',
        '.points-possible',
        '.assignment-header .points',
        '.ig-details__item'
      ];

      for (const selector of pointsSelectors) {
        const pointsEl = document.querySelector(selector);
        if (pointsEl) {
          const text = pointsEl.textContent.trim();
          const match = text.match(/(\d+(?:\.\d+)?)\s*points?/i) || text.match(/(\d+(?:\.\d+)?)/);
          if (match) {
            return parseFloat(match[1]);
          }
        }
      }

      // Try to find in assignment header or sidebar
      const headerText = document.querySelector('.assignment-header, .ig-header')?.textContent || '';
      const pointsMatch = headerText.match(/(\d+(?:\.\d+)?)\s*points?/i);
      if (pointsMatch) {
        return parseFloat(pointsMatch[1]);
      }

      return null;
    });
    assignmentData.points = points;

    // Extract due date - improved selectors
    const dueDate = await page.evaluate(() => {
      const dueSelectors = [
        '.due-date',
        '[data-testid="due-date"]',
        '.assignment-due-date',
        '.due-date-display',
        '.ig-details__item',
        'time[datetime]',
        '[title*="Due"]'
      ];

      for (const selector of dueSelectors) {
        const dueEl = document.querySelector(selector);
        if (dueEl) {
          const datetime = dueEl.getAttribute('datetime') ||
                          dueEl.getAttribute('data-html-tooltip-title') || 
                          dueEl.getAttribute('title') ||
                          dueEl.textContent.trim();
          if (datetime && datetime.length > 0) {
            return datetime;
          }
        }
      }

      // Try to find in assignment header
      const headerText = document.querySelector('.assignment-header, .ig-header')?.textContent || '';
      const dueMatch = headerText.match(/Due:\s*([^\n]+)/i);
      if (dueMatch) {
        return dueMatch[1].trim();
      }

      return null;
    });
    assignmentData.dueDate = dueDate;

    // Extract submission types
    const submissionTypes = await page.evaluate(() => {
      const types = [];
      const typeElements = document.querySelectorAll('.submission-types li, [data-testid="submission-type"]');
      typeElements.forEach(el => {
        const text = el.textContent.trim();
        if (text) types.push(text);
      });
      return types;
    });
    assignmentData.submissionTypes = submissionTypes;

    // Extract assignment group
    const assignmentGroup = await page.evaluate(() => {
      const groupEl = document.querySelector('.assignment-group, [data-testid="assignment-group"]');
      return groupEl ? groupEl.textContent.trim() : null;
    });
    assignmentData.assignmentGroup = assignmentGroup;

    // Extract rubric (if present)
    const rubric = await page.evaluate(() => {
      const rubricEl = document.querySelector('.rubric, [data-testid="rubric"]');
      if (rubricEl) {
        const criteria = [];
        const criteriaElements = rubricEl.querySelectorAll('.rubric-criterion, .criterion');
        criteriaElements.forEach(criterion => {
          const criterionData = {
            description: criterion.querySelector('.criterion-description')?.textContent.trim() || null,
            points: criterion.querySelector('.points')?.textContent.trim() || null,
            ratings: []
          };
          const ratings = criterion.querySelectorAll('.rating');
          ratings.forEach(rating => {
            criterionData.ratings.push({
              description: rating.querySelector('.rating-description')?.textContent.trim() || null,
              points: rating.querySelector('.points')?.textContent.trim() || null
            });
          });
          criteria.push(criterionData);
        });
        return criteria.length > 0 ? criteria : null;
      }
      return null;
    });
    assignmentData.rubric = rubric;

    // Extract attachments/files
    const attachments = await page.evaluate(() => {
      const attachments = [];
      const fileLinks = document.querySelectorAll('.attachment a, .file a, [data-testid="attachment"]');
      fileLinks.forEach(link => {
        const href = link.getAttribute('href');
        const name = link.textContent.trim() || link.getAttribute('title') || null;
        if (href && name) {
          const normalizedHref = href.startsWith('http') ? href : new URL(href, window.location.href).href;
          if (normalizedHref.includes('/submissions/') || normalizedHref.includes('/gradebook')) {
            return;
          }
          attachments.push({
            name,
            url: normalizedHref,
            type: normalizedHref.match(/\.(\w+)(?:\?|$)/)?.[1] || null
          });
        }
      });
      return attachments;
    });
    assignmentData.attachments = attachments;

    // Extract submission status (if student view)
    // Prioritize status from the assignments list page if provided
    const listPageStatus = options.listPageStatus || null;
    if (listPageStatus) {
      assignmentData.submissionStatus = listPageStatus.submissionStatus;
      assignmentData.submissionStatusText = listPageStatus.submissionStatusText;
    } else {
      // Fallback to extracting from the individual assignment page
      const submissionStatus = await page.evaluate(() => {
        const statusEl = document.querySelector('.submission-status, [data-testid="submission-status"]');
        if (!statusEl) {
          return { hasSubmission: null, rawText: null };
        }
        const rawText = statusEl.textContent.trim();
        if (!rawText) {
          return { hasSubmission: null, rawText: null };
        }
        const normalized = rawText.toLowerCase();
        const positiveIndicators = ['submitted', 'turned in', 'resubmitted', 'graded'];
        const negativeIndicators = ['missing', 'not submitted', 'no submission', 'incomplete', 'unsubmitted'];
        if (positiveIndicators.some(indicator => normalized.includes(indicator))) {
          return { hasSubmission: true, rawText };
        }
        if (negativeIndicators.some(indicator => normalized.includes(indicator))) {
          return { hasSubmission: false, rawText };
        }
        return { hasSubmission: null, rawText };
      });
      assignmentData.submissionStatus = submissionStatus.hasSubmission === null
        ? null
        : (submissionStatus.hasSubmission ? 'yes' : 'no');
      assignmentData.submissionStatusText = submissionStatus.rawText;
    }

    // Extract published status
    const isPublished = await page.evaluate(() => {
      const publishedEl = document.querySelector('.published-status, [data-testid="published-status"]');
      if (publishedEl) {
        const text = publishedEl.textContent.trim().toLowerCase();
        return text.includes('published') || text.includes('available');
      }
      // Check for unpublished indicator
      const unpublishedEl = document.querySelector('.unpublished, [data-testid="unpublished"]');
      return !unpublishedEl;
    });
    assignmentData.isPublished = isPublished;

    return assignmentData;
  } catch (error) {
    return {
      url,
      error: error.message,
      extractedAt: new Date().toISOString()
    };
  }
}

/**
 * Remove DOM nodes that can expose student submissions, attachments, or grades.
 * This ensures downstream extractors cannot accidentally scrape student work.
 * @param {Object} page - Playwright page instance
 * @returns {Promise<number>} - Count of removed nodes
 */
async function scrubSensitiveSubmissionElements(page) {
  const blockedSelectors = [
    '#submission_history',
    '.submission-attachments',
    '.submission_attachment',
    '.submission-comments',
    '.submission-comment',
    '.SubmissionComments',
    '.graded-submission',
    '.grading-box',
    '.grading',
    '.submission-content',
    '[data-testid="submission-attachment"]',
    '[data-testid="student-work"]',
    'a[href*="/submissions/"]',
    'form[action*="/submissions"]'
  ];

  const removedCount = await page.evaluate((selectors) => {
    let count = 0;
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((node) => {
        node.remove();
        count += 1;
      });
    });
    return count;
  }, blockedSelectors);

  return removedCount;
}

module.exports = {
  extractAssignment
};

