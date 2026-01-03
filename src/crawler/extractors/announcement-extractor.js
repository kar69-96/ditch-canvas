/**
 * Announcement Extractor
 * Extracts announcements with full content from Canvas
 */

/**
 * Extracts announcement data from a Canvas announcement page
 * @param {Object} page - Playwright page object
 * @param {string} url - The announcement URL
 * @returns {Promise<Object>} - Announcement data object
 */
async function extractAnnouncement(page, url) {
  try {
    // Extract course ID and announcement ID from URL
    const courseIdMatch = url.match(/\/courses\/(\d+)/);
    const courseId = courseIdMatch ? courseIdMatch[1] : null;
    
    const announcementIdMatch = url.match(/\/discussion_topics\/(\d+)/);
    const announcementId = announcementIdMatch ? announcementIdMatch[1] : null;

    const announcementData = {
      announcementId,
      courseId,
      url,
      extractedAt: new Date().toISOString(),
      isAnnouncement: true, // Mark as announcement
    };
    
    // Check if this is actually an announcement (vs regular discussion)
    // Canvas announcements are discussion topics with specific indicators
    const isActuallyAnnouncement = await page.evaluate(() => {
      // Check for announcement indicators
      const announcementIndicators = [
        '.announcement',
        '[data-testid="announcement"]',
        '.discussion-topic.is_announcement',
        '.is_announcement',
        'body.announcements'
      ];
      
      for (const selector of announcementIndicators) {
        if (document.querySelector(selector)) {
          return true;
        }
      }
      
      // Check URL or page title
      if (window.location.href.includes('announcement') || 
          document.title.toLowerCase().includes('announcement')) {
        return true;
      }
      
      // Check if we're on announcements page context
      const breadcrumb = document.querySelector('.breadcrumbs, .ef-breadcrumbs');
      if (breadcrumb && breadcrumb.textContent.toLowerCase().includes('announcement')) {
        return true;
      }
      
      return false;
    });
    
    announcementData.isAnnouncement = isActuallyAnnouncement;

    // Wait for page content to load
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    await page.waitForSelector('h1, h2, .discussion-topic, .announcement, main', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000); // Wait for dynamic content

    // Wait for title to be visible
    await page.waitForFunction(() => {
      const h1 = document.querySelector('h1');
      const h2 = document.querySelector('h2');
      if (h1 && h1.textContent.trim() && !h1.textContent.includes('Loading')) return true;
      if (h2 && h2.textContent.trim() && !h2.textContent.includes('Loading')) return true;
      return false;
    }, { timeout: 5000 }).catch(() => {});

    // Extract announcement title
    const title = await page.evaluate(() => {
      const titleSelectors = [
        'h1',
        'h2',
        '.discussion-title',
        '.announcement-title',
        '.ig-header-title',
        '[data-testid="announcement-title"]',
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
    announcementData.title = title;

    // Wait for announcement content to load - try multiple strategies
    await page.waitForFunction(() => {
      // Check for various content indicators
      const contentIndicators = [
        '.user_content',
        '.discussion-content',
        '.announcement-content',
        '.message',
        '.entry-content',
        '.discussion-entry',
        '.discussion-topic-content',
        '[data-testid="announcement-content"]',
        '.discussion-message',
        '.topic-content'
      ];
      
      for (const selector of contentIndicators) {
        const el = document.querySelector(selector);
        if (el) {
          const text = el.textContent.trim();
          if (text && text.length > 10 && !text.includes('Loading')) {
            return true;
          }
        }
      }
      return false;
    }, { timeout: 8000 }).catch(() => {});
    
    // Additional wait for dynamic content
    await page.waitForTimeout(1500);

    // Extract announcement content - using specific Canvas selectors from HTML structure
    const content = await page.evaluate(() => {
      // Strategy 1: Look for data-resource-type="announcement.body" (from the HTML structure shown)
      const announcementBody = document.querySelector('[data-resource-type="announcement.body"]');
      if (announcementBody) {
        const html = announcementBody.innerHTML.trim();
        const text = announcementBody.textContent.trim();
        if (html && html.length > 20 && text && text.length > 5 && !text.includes('Loading')) {
          return html;
        }
      }
      
      // Strategy 2: Look for .user_content.enhanced (from the HTML structure shown)
      const userContentEnhanced = document.querySelector('.user_content.enhanced');
      if (userContentEnhanced) {
        const html = userContentEnhanced.innerHTML.trim();
        const text = userContentEnhanced.textContent.trim();
        if (html && html.length > 20 && text && text.length > 5 && !text.includes('Loading')) {
          return html;
        }
      }
      
      // Strategy 3: Look for .userMessage or message area
      const userMessage = document.querySelector('.userMessage, .message');
      if (userMessage) {
        const contentEl = userMessage.querySelector('[data-resource-type="announcement.body"], .user_content, p');
        if (contentEl) {
          const html = contentEl.innerHTML.trim();
          const text = contentEl.textContent.trim();
          if (html && html.length > 20 && text && text.length > 5 && !text.includes('Loading')) {
            return html;
          }
        }
      }
      
      // Strategy 4: Try multiple specific content selectors
      const contentSelectors = [
        '[data-resource-type="announcement.body"]',
        '.user_content.enhanced',
        '.user_content',
        '.userMessage [data-resource-type="announcement.body"]',
        '.userMessage .user_content',
        '.discussion-content',
        '.announcement-content',
        '.message',
        '.entry-content',
        '.discussion-entry',
        '.discussion-topic-content',
        '[data-testid="announcement-content"]',
        '.discussion-message',
        '.topic-content'
      ];
      
      for (const selector of contentSelectors) {
        const contentEl = document.querySelector(selector);
        if (contentEl) {
          const html = contentEl.innerHTML.trim();
          const text = contentEl.textContent.trim();
          // More lenient check - some announcements might be short
          if (html && html.length > 20 && text && text.length > 5 && !text.includes('Loading')) {
            return html;
          }
        }
      }
      
      // Strategy 5: Look in main content area
      const mainContent = document.querySelector('main, .main-content, .content-wrapper, #content, .discussion-topic');
      if (mainContent) {
        // Try to find announcement body or user_content within main
        const userContent = mainContent.querySelector('[data-resource-type="announcement.body"], .user_content, .message, .discussion-content, .announcement-content, .entry-content');
        if (userContent) {
          const html = userContent.innerHTML.trim();
          const text = userContent.textContent.trim();
          if (html && html.length > 20 && text && text.length > 5 && !text.includes('Loading')) {
            return html;
          }
        }
        
        // Strategy 6: Get all content except headers/navigation
        const contentClone = mainContent.cloneNode(true);
        // Remove header elements, navigation, and loading spinners
        contentClone.querySelectorAll('h1, h2, h3, header, .page-header, .spinner, [class*="loading"], nav, .breadcrumbs').forEach(el => el.remove());
        
        // Try to find the main message/entry area
        const entryArea = contentClone.querySelector('.entry, .discussion-entry, .message-wrapper, .topic-entry, .userMessage');
        if (entryArea) {
          const bodyContent = entryArea.querySelector('[data-resource-type="announcement.body"], .user_content, p');
          if (bodyContent) {
            const html = bodyContent.innerHTML.trim();
            const text = bodyContent.textContent.trim();
            if (html && html.length > 20 && text && text.length > 5 && !text.includes('Loading')) {
              return html;
            }
          }
        }
      }
      
      return null;
    });
    announcementData.content = content;
    announcementData.contentText = content ? 
      await page.evaluate((html) => {
        const div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent || div.innerText || '';
      }, content) : null;

    // Extract author information - using specific Canvas selectors from HTML structure
    const author = await page.evaluate(() => {
      // Strategy 1: Look for data-testid="author_name" (from the HTML structure shown)
      const authorNameEl = document.querySelector('[data-testid="author_name"]');
      if (authorNameEl) {
        const text = authorNameEl.textContent.trim();
        if (text && text.length > 0 && text.length < 100) {
          return text;
        }
      }
      
      // Strategy 2: Look for link with href containing /users/ (author profile link)
      const authorLink = document.querySelector('a[href*="/users/"]');
      if (authorLink) {
        // Check if it's in an author context
        const linkText = authorLink.textContent.trim();
        const parent = authorLink.closest('[data-testid*="author"], .author, [class*="author"]');
        if (linkText && linkText.length > 0 && linkText.length < 100 && 
            (parent || linkText.match(/^[A-Z][a-z]+ [A-Z][a-z]+/))) { // Looks like a name
          return linkText;
        }
      }
      
      // Strategy 3: Look for text pattern "NAME AUTHOR | TEACHER" or similar
      const authorPattern = document.body.textContent.match(/([A-Z][a-z]+ [A-Z][a-z]+)\s+(?:AUTHOR|TEACHER|STUDENT)/);
      if (authorPattern && authorPattern[1]) {
        return authorPattern[1];
      }
      
      // Strategy 4: Try other selectors
      const authorSelectors = [
        '[data-testid="author_name"]',
        'a[href*="/users/"]',
        '.author',
        '.discussion-author',
        '.announcement-author',
        '[data-testid="author"]',
        '.entry-author',
        '.posted-by',
        '.discussion-entry .author',
        '.entry .author',
        '.message-author',
        '.topic-author'
      ];
      
      for (const selector of authorSelectors) {
        const authorEl = document.querySelector(selector);
        if (authorEl) {
          const text = authorEl.textContent.trim();
          // Filter out "AUTHOR | TEACHER" type text, just get the name
          const nameMatch = text.match(/([A-Z][a-z]+ [A-Z][a-z]+)/);
          if (nameMatch) {
            return nameMatch[1];
          }
          if (text && text.length > 0 && text.length < 100 && !text.includes('AUTHOR') && !text.includes('TEACHER')) {
            return text;
          }
        }
      }
      
      // Strategy 5: Look in entry or discussion header
      const entry = document.querySelector('.entry, .discussion-entry, .discussion-topic, [data-resource-type="announcement.body"]')?.closest('div');
      if (entry) {
        const entryAuthor = entry.querySelector('[data-testid="author_name"], a[href*="/users/"], .author, .posted-by');
        if (entryAuthor) {
          const text = entryAuthor.textContent.trim();
          const nameMatch = text.match(/([A-Z][a-z]+ [A-Z][a-z]+)/);
          if (nameMatch) {
            return nameMatch[1];
          }
          if (text && text.length > 0 && text.length < 100 && !text.includes('AUTHOR')) {
            return text;
          }
        }
      }
      
      return null;
    });
    announcementData.author = author;

    // Extract post date - using specific Canvas selectors from HTML structure
    const postDate = await page.evaluate(() => {
      // Strategy 1: Look for text pattern "Posted Nov 12 9:53pm" (from the HTML structure shown)
      // The date is in a span with class containing "text" near author info
      const dateTextPattern = document.body.textContent.match(/Posted\s+([A-Z][a-z]{2}\s+\d{1,2}\s+\d{1,2}:\d{2}(?:am|pm))/i);
      if (dateTextPattern) {
        return dateTextPattern[0]; // Return "Posted Nov 12 9:53pm"
      }
      
      // Strategy 2: Look for span with "Posted" text and extract date from nearby elements
      const postedElements = Array.from(document.querySelectorAll('*')).filter(el => 
        el.textContent && el.textContent.includes('Posted')
      );
      
      for (const el of postedElements) {
        const text = el.textContent.trim();
        // Look for "Posted [date]" pattern
        const dateMatch = text.match(/Posted\s+(.+?)(?:\s*\||\s*$)/i);
        if (dateMatch && dateMatch[1]) {
          return `Posted ${dateMatch[1].trim()}`;
        }
        // Or just get the full text if it contains Posted
        if (text.includes('Posted') && text.length < 100) {
          return text;
        }
      }
      
      // Strategy 3: Look for time elements with datetime attribute
      const timeEl = document.querySelector('time[datetime]');
      if (timeEl) {
        const datetime = timeEl.getAttribute('datetime');
        if (datetime) {
          return datetime;
        }
      }
      
      // Strategy 4: Try other date selectors
      const dateSelectors = [
        'time[datetime]',
        '.posted-at',
        '.discussion-date',
        '.announcement-date',
        '[data-testid="post-date"]',
        '.entry-date',
        '[title*="Posted"], [title*="Date"]',
        '.discussion-entry time',
        '.entry time',
        '.message-date',
        '.topic-date'
      ];
      
      for (const selector of dateSelectors) {
        const dateEl = document.querySelector(selector);
        if (dateEl) {
          const datetime = dateEl.getAttribute('datetime') || 
                          dateEl.getAttribute('title') || 
                          dateEl.getAttribute('data-timestamp') ||
                          dateEl.textContent.trim();
          if (datetime && datetime.length > 0) {
            return datetime;
          }
        }
      }
      
      // Strategy 5: Look in entry or discussion header area
      const entry = document.querySelector('.entry, .discussion-entry, .discussion-topic, [data-resource-type="announcement.body"]')?.closest('div');
      if (entry) {
        // Look for text containing "Posted" in the entry
        const entryText = entry.textContent;
        const postedMatch = entryText.match(/Posted\s+([A-Z][a-z]{2}\s+\d{1,2}\s+\d{1,2}:\d{2}(?:am|pm))/i);
        if (postedMatch) {
          return postedMatch[0];
        }
        
        const entryDate = entry.querySelector('time[datetime], .date, .posted-at, [class*="date"], [class*="text"]');
        if (entryDate) {
          const text = entryDate.textContent.trim();
          if (text.includes('Posted') || text.match(/\d{1,2}:\d{2}(?:am|pm)/)) {
            return text;
          }
        }
      }
      
      return null;
    });
    announcementData.postDate = postDate;

    // Extract attachments
    const attachments = await page.evaluate(() => {
      const attachments = [];
      const attachmentSelectors = [
        '.attachment a',
        '.file a',
        'a[href*="/files/"]',
        '[data-testid="attachment"]'
      ];
      
      attachmentSelectors.forEach(selector => {
        const links = document.querySelectorAll(selector);
        links.forEach(link => {
          const href = link.getAttribute('href');
          const name = link.textContent.trim() || link.getAttribute('title') || null;
          if (href && name) {
            attachments.push({
              name,
              url: href.startsWith('http') ? href : new URL(href, window.location.href).href,
              type: href.match(/\.(\w+)(?:\?|$)/)?.[1] || null
            });
          }
        });
      });
      
      return attachments;
    });
    announcementData.attachments = attachments;

    // Extract comments/replies (if any)
    const comments = await page.evaluate(() => {
      const comments = [];
      const commentElements = document.querySelectorAll('.discussion-reply, .entry, .comment, [data-testid="comment"]');
      
      commentElements.forEach(commentEl => {
        const comment = {
          author: null,
          content: null,
          date: null
        };

        const authorEl = commentEl.querySelector('.author, .entry-author, .comment-author');
        if (authorEl) {
          comment.author = authorEl.textContent.trim();
        }

        const contentEl = commentEl.querySelector('.message, .entry-content, .comment-content, .user_content');
        if (contentEl) {
          comment.content = contentEl.innerHTML.trim();
          comment.contentText = contentEl.textContent.trim();
        }

        const dateEl = commentEl.querySelector('time[datetime], .posted-at, .entry-date');
        if (dateEl) {
          comment.date = dateEl.getAttribute('datetime') || dateEl.textContent.trim();
        }

        if (comment.content || comment.author) {
          comments.push(comment);
        }
      });
      
      return comments;
    });
    announcementData.comments = comments;
    announcementData.commentCount = comments.length;

    // Extract visibility/posting information
    const visibility = await page.evaluate(() => {
      const visibilityInfo = {
        isPublished: true,
        isPinned: false,
        allowComments: false
      };

      const unpublishedEl = document.querySelector('.unpublished, [data-testid="unpublished"]');
      visibilityInfo.isPublished = !unpublishedEl;

      const pinnedEl = document.querySelector('.pinned, [data-testid="pinned"]');
      visibilityInfo.isPinned = !!pinnedEl;

      const commentsDisabled = document.querySelector('.comments-disabled, [data-testid="comments-disabled"]');
      visibilityInfo.allowComments = !commentsDisabled;

      return visibilityInfo;
    });
    announcementData.visibility = visibility;

    return announcementData;
  } catch (error) {
    return {
      url,
      error: error.message,
      extractedAt: new Date().toISOString()
    };
  }
}

module.exports = {
  extractAnnouncement
};
