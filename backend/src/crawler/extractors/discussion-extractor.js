/**
 * Discussion Extractor
 * Extracts discussion topics with full threads from Canvas
 */

/**
 * Extracts discussion data from a Canvas discussion page
 * @param {Object} page - Playwright page object
 * @param {string} url - The discussion URL
 * @returns {Promise<Object>} - Discussion data object
 */
async function extractDiscussion(page, url) {
  try {
    // Extract course ID and discussion ID from URL
    const courseIdMatch = url.match(/\/courses\/(\d+)/);
    const courseId = courseIdMatch ? courseIdMatch[1] : null;
    
    const discussionIdMatch = url.match(/\/discussion_topics\/(\d+)/);
    const discussionId = discussionIdMatch ? discussionIdMatch[1] : null;

    const discussionData = {
      discussionId,
      courseId,
      url,
      extractedAt: new Date().toISOString(),
      isAnnouncement: false, // Discussions are not announcements
    };

    // Wait for page content to load
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    await page.waitForSelector('h1, h2, .discussion-topic, .discussion, main', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000); // Wait for dynamic content

    // Wait for title to be visible
    await page.waitForFunction(() => {
      const h1 = document.querySelector('h1');
      const h2 = document.querySelector('h2');
      if (h1 && h1.textContent.trim() && !h1.textContent.includes('Loading')) return true;
      if (h2 && h2.textContent.trim() && !h2.textContent.includes('Loading')) return true;
      return false;
    }, { timeout: 5000 }).catch(() => {});

    // Extract discussion title
    const title = await page.evaluate(() => {
      const titleSelectors = [
        'h1',
        'h2',
        '.discussion-title',
        '.discussion-topic-title',
        '.ig-header-title',
        '[data-testid="discussion-title"]',
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
    discussionData.title = title;

    // Wait for discussion content to load
    await page.waitForFunction(() => {
      const contentIndicators = [
        '.user_content',
        '.discussion-content',
        '.message',
        '.entry-content',
        '[data-resource-type="discussion.body"]'
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

    // Extract discussion content
    const content = await page.evaluate(() => {
      // Strategy 1: Look for data-resource-type="discussion.body" or announcement.body
      const discussionBody = document.querySelector('[data-resource-type="discussion.body"], [data-resource-type="announcement.body"]');
      if (discussionBody) {
        const html = discussionBody.innerHTML.trim();
        const text = discussionBody.textContent.trim();
        if (html && html.length > 20 && text && text.length > 5 && !text.includes('Loading')) {
          return html;
        }
      }
      
      // Strategy 2: Look for .user_content.enhanced
      const userContentEnhanced = document.querySelector('.user_content.enhanced');
      if (userContentEnhanced) {
        const html = userContentEnhanced.innerHTML.trim();
        const text = userContentEnhanced.textContent.trim();
        if (html && html.length > 20 && text && text.length > 5 && !text.includes('Loading')) {
          return html;
        }
      }
      
      // Strategy 3: Try multiple content selectors
      const contentSelectors = [
        '[data-resource-type="discussion.body"]',
        '[data-resource-type="announcement.body"]',
        '.user_content.enhanced',
        '.user_content',
        '.discussion-content',
        '.message',
        '.entry-content',
        '.discussion-entry',
        '.discussion-topic-content'
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
      
      // Strategy 4: Look in main content area
      const mainContent = document.querySelector('main, .main-content, .content-wrapper, #content, .discussion-topic');
      if (mainContent) {
        const userContent = mainContent.querySelector('[data-resource-type="discussion.body"], [data-resource-type="announcement.body"], .user_content, .message, .discussion-content');
        if (userContent) {
          const html = userContent.innerHTML.trim();
          const text = userContent.textContent.trim();
          if (html && html.length > 20 && text && text.length > 5 && !text.includes('Loading')) {
            return html;
          }
        }
      }
      
      return null;
    });
    discussionData.content = content;
    discussionData.contentText = content ? 
      await page.evaluate((html) => {
        const div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent || div.innerText || '';
      }, content) : null;

    // Extract author information
    const author = await page.evaluate(() => {
      // Strategy 1: Look for data-testid="author_name"
      const authorNameEl = document.querySelector('[data-testid="author_name"]');
      if (authorNameEl) {
        const text = authorNameEl.textContent.trim();
        if (text && text.length > 0 && text.length < 100) {
          return text;
        }
      }
      
      // Strategy 2: Look for link with href containing /users/
      const authorLink = document.querySelector('a[href*="/users/"]');
      if (authorLink) {
        const linkText = authorLink.textContent.trim();
        const parent = authorLink.closest('[data-testid*="author"], .author, [class*="author"]');
        if (linkText && linkText.length > 0 && linkText.length < 100 && 
            (parent || linkText.match(/^[A-Z][a-z]+ [A-Z][a-z]+/))) {
          return linkText;
        }
      }
      
      // Strategy 3: Look for text pattern "NAME AUTHOR | TEACHER"
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
        '[data-testid="author"]',
        '.entry-author',
        '.posted-by'
      ];
      
      for (const selector of authorSelectors) {
        const authorEl = document.querySelector(selector);
        if (authorEl) {
          const text = authorEl.textContent.trim();
          const nameMatch = text.match(/([A-Z][a-z]+ [A-Z][a-z]+)/);
          if (nameMatch) {
            return nameMatch[1];
          }
          if (text && text.length > 0 && text.length < 100 && !text.includes('AUTHOR') && !text.includes('TEACHER')) {
            return text;
          }
        }
      }
      
      return null;
    });
    discussionData.author = author;

    // Extract post date
    const postDate = await page.evaluate(() => {
      // Strategy 1: Look for "Posted [date]" pattern
      const dateTextPattern = document.body.textContent.match(/Posted\s+([A-Z][a-z]{2}\s+\d{1,2}\s+\d{1,2}:\d{2}(?:am|pm))/i);
      if (dateTextPattern) {
        return dateTextPattern[0];
      }
      
      // Strategy 2: Look for elements containing "Posted"
      const postedElements = Array.from(document.querySelectorAll('*')).filter(el => 
        el.textContent && el.textContent.includes('Posted')
      );
      
      for (const el of postedElements) {
        const text = el.textContent.trim();
        const dateMatch = text.match(/Posted\s+(.+?)(?:\s*\||\s*$)/i);
        if (dateMatch && dateMatch[1]) {
          return `Posted ${dateMatch[1].trim()}`;
        }
        if (text.includes('Posted') && text.length < 100) {
          return text;
        }
      }
      
      // Strategy 3: Look for time elements
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
        '[data-testid="post-date"]',
        '.entry-date',
        '[title*="Posted"], [title*="Date"]'
      ];
      
      for (const selector of dateSelectors) {
        const dateEl = document.querySelector(selector);
        if (dateEl) {
          const datetime = dateEl.getAttribute('datetime') || 
                          dateEl.getAttribute('title') ||
                          dateEl.textContent.trim();
          if (datetime && datetime.length > 0) {
            return datetime;
          }
        }
      }
      
      return null;
    });
    discussionData.postDate = postDate;

    // Extract replies/threads
    const replies = await page.evaluate(() => {
      const replies = [];
      
      // Find all reply entries (excluding the main post)
      const replyElements = document.querySelectorAll('.discussion-reply, .entry, .comment, [data-testid="comment"], .discussion-entry');
      
      replyElements.forEach((replyEl, index) => {
        // Skip if this looks like the main post (usually first or has different structure)
        if (index === 0 && replyEl.closest('.discussion-topic')) {
          return; // Skip main post
        }
        
        const reply = {
          replyId: null,
          author: null,
          content: null,
          contentText: null,
          date: null,
          parentId: null,
          depth: 0
        };

        // Extract reply ID
        const idMatch = replyEl.getAttribute('id') || replyEl.getAttribute('data-id');
        if (idMatch) {
          reply.replyId = idMatch;
        }

        // Extract author
        const authorEl = replyEl.querySelector('[data-testid="author_name"], a[href*="/users/"], .author, .entry-author, .comment-author');
        if (authorEl) {
          const text = authorEl.textContent.trim();
          const nameMatch = text.match(/([A-Z][a-z]+ [A-Z][a-z]+)/);
          reply.author = nameMatch ? nameMatch[1] : text;
        }

        // Extract content
        const contentEl = replyEl.querySelector('.message, .entry-content, .comment-content, .user_content, [data-resource-type*="body"]');
        if (contentEl) {
          reply.content = contentEl.innerHTML.trim();
          reply.contentText = contentEl.textContent.trim();
        }

        // Extract date
        const dateEl = replyEl.querySelector('time[datetime], .posted-at, .entry-date');
        if (dateEl) {
          reply.date = dateEl.getAttribute('datetime') || dateEl.textContent.trim();
        }

        // Determine depth (nesting level)
        let depth = 0;
        let parent = replyEl.parentElement;
        while (parent && parent !== document.body) {
          if (parent.classList.contains('discussion-reply') || 
              parent.classList.contains('entry') || 
              parent.classList.contains('comment')) {
            depth++;
          }
          parent = parent.parentElement;
        }
        reply.depth = depth;

        if (reply.content || reply.author) {
          replies.push(reply);
        }
      });
      
      return replies;
    });
    discussionData.replies = replies;
    discussionData.replyCount = replies.length;

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
    discussionData.attachments = attachments;

    // Extract discussion metadata
    const metadata = await page.evaluate(() => {
      const meta = {
        isPublished: true,
        isPinned: false,
        allowComments: true,
        isLocked: false,
        isGraded: false
      };

      const unpublishedEl = document.querySelector('.unpublished, [data-testid="unpublished"]');
      meta.isPublished = !unpublishedEl;

      const pinnedEl = document.querySelector('.pinned, [data-testid="pinned"]');
      meta.isPinned = !!pinnedEl;

      const commentsDisabled = document.querySelector('.comments-disabled, [data-testid="comments-disabled"]');
      meta.allowComments = !commentsDisabled;

      const lockedEl = document.querySelector('.locked, [data-testid="locked"]');
      meta.isLocked = !!lockedEl;

      const gradedEl = document.querySelector('.graded, [data-testid="graded"]');
      meta.isGraded = !!gradedEl;

      return meta;
    });
    discussionData.metadata = metadata;

    return discussionData;
  } catch (error) {
    return {
      url,
      error: error.message,
      extractedAt: new Date().toISOString()
    };
  }
}

module.exports = {
  extractDiscussion
};
