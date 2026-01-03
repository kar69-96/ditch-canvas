/**
 * Announcements List Extractor
 * Extracts all announcements from the Canvas announcements list page
 */

const { extractAnnouncement } = require('./announcement-extractor.js');

/**
 * Extracts all announcements from the announcements list page
 * @param {Object} page - Playwright page object
 * @param {string} url - The announcements list page URL
 * @param {string} courseId - The course ID
 * @returns {Promise<Array>} - Array of announcement data objects
 */
async function extractAnnouncementsFromList(page, url, courseId) {
  try {
    // Wait for announcements list to load
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    await page.waitForSelector('.discussion-list, .announcements-list, a[href*="/discussion_topics/"]', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000);

    // Extract all announcement links from the list page
    const announcementLinks = await page.evaluate(() => {
      const links = [];
      // Find all discussion topic links (announcements are discussion topics in Canvas)
      const topicLinks = document.querySelectorAll('a[href*="/discussion_topics/"]');
      topicLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (href && !href.includes('/download') && !href.includes('comment_id=')) {
          const fullUrl = href.startsWith('http') ? href : new URL(href, window.location.href).href;
          links.push(fullUrl);
        }
      });
      return [...new Set(links)]; // Remove duplicates
    });

    if (announcementLinks.length === 0) {
      return [];
    }

    // Extract basic info from list items (title, date, author) without visiting each page
    const announcementsData = await page.evaluate((links) => {
      const announcements = [];
      
      links.forEach(linkUrl => {
        const announcement = {
          url: linkUrl,
          title: null,
          author: null,
          postDate: null,
          isAnnouncement: true
        };

        // Try to find the list item containing this link
        const linkElement = Array.from(document.querySelectorAll('a[href*="/discussion_topics/"]'))
          .find(link => {
            const href = link.getAttribute('href');
            const fullUrl = href.startsWith('http') ? href : new URL(href, window.location.href).href;
            return fullUrl === linkUrl;
          });

        if (linkElement) {
          // Get title from link text
          announcement.title = linkElement.textContent.trim();

          // Try to find parent container for additional metadata
          const listItem = linkElement.closest('.discussion, .announcement, .discussion-list-item, .discussion-topic, li, tr, .ig-list-item');
          if (listItem) {
            // Try to find author - try multiple selectors
            const authorSelectors = [
              '.author',
              '.posted-by',
              '.user-name',
              '.discussion-author',
              '.entry-author',
              '[data-testid="author"]',
              '.ig-list-item__content .author'
            ];
            
            for (const selector of authorSelectors) {
              const authorEl = listItem.querySelector(selector);
              if (authorEl) {
                announcement.author = authorEl.textContent.trim();
                break;
              }
            }

            // Try to find date - try multiple selectors
            const dateSelectors = [
              'time[datetime]',
              '.posted-at',
              '.date',
              '.discussion-date',
              '.entry-date',
              '[data-testid="post-date"]',
              '.ig-list-item__content time',
              '.ig-list-item__content .date'
            ];
            
            for (const selector of dateSelectors) {
              const dateEl = listItem.querySelector(selector);
              if (dateEl) {
                announcement.postDate = dateEl.getAttribute('datetime') || 
                                       dateEl.getAttribute('title') ||
                                       dateEl.textContent.trim();
                if (announcement.postDate) break;
              }
            }
            
            // Try to extract from list item text if not found
            if (!announcement.postDate) {
              const listItemText = listItem.textContent;
              // Look for date patterns
              const datePatterns = [
                /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}/,
                /\d{1,2}\/\d{1,2}\/\d{2,4}/,
                /\d{4}-\d{2}-\d{2}/
              ];
              
              for (const pattern of datePatterns) {
                const match = listItemText.match(pattern);
                if (match) {
                  announcement.postDate = match[0];
                  break;
                }
              }
            }
          }
        }

        if (announcement.title) {
          announcements.push(announcement);
        }
      });

      return announcements;
    }, announcementLinks);

    // For each announcement, we could visit the page for full extraction
    // But for now, return the list data
    return announcementsData.map(announcement => ({
      ...announcement,
      courseId,
      extractedAt: new Date().toISOString(),
      extractedFromList: true
    }));

  } catch (error) {
    return [];
  }
}

module.exports = {
  extractAnnouncementsFromList
};

