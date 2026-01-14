/**
 * Mock Notion API for testing
 * Provides mock responses for Notion integration
 */

class MockNotionAPI {
  constructor() {
    this.databases = {};
    this.pages = {};
    this.requests = [];
  }

  // Reset all data
  reset() {
    this.databases = {};
    this.pages = {};
    this.requests = [];
  }

  // Track API request
  trackRequest(method, endpoint, data = {}) {
    this.requests.push({ method, endpoint, data, timestamp: Date.now() });
  }

  // Create database
  createDatabase(parentPageId, title, properties) {
    const databaseId = `db_${Math.random().toString(36).substring(7)}`;
    this.databases[databaseId] = {
      id: databaseId,
      parent: { type: 'page_id', page_id: parentPageId },
      title: [{ text: { content: title } }],
      properties,
      created_time: new Date().toISOString(),
      last_edited_time: new Date().toISOString(),
    };

    this.trackRequest('POST', '/databases', { parentPageId, title, properties });
    return this.databases[databaseId];
  }

  // Get database
  getDatabase(databaseId) {
    this.trackRequest('GET', `/databases/${databaseId}`);
    if (!this.databases[databaseId]) {
      throw new Error(`Database ${databaseId} not found`);
    }
    return this.databases[databaseId];
  }

  // Query database
  queryDatabase(databaseId, filter = {}, sorts = []) {
    this.trackRequest('POST', `/databases/${databaseId}/query`, { filter, sorts });

    if (!this.databases[databaseId]) {
      throw new Error(`Database ${databaseId} not found`);
    }

    // Get all pages in this database
    const pages = Object.values(this.pages).filter(
      page => page.parent?.database_id === databaseId
    );

    return {
      results: pages,
      has_more: false,
      next_cursor: null,
    };
  }

  // Create page in database
  createPage(databaseId, properties, content = []) {
    const pageId = `page_${Math.random().toString(36).substring(7)}`;
    this.pages[pageId] = {
      id: pageId,
      parent: { type: 'database_id', database_id: databaseId },
      properties,
      content,
      created_time: new Date().toISOString(),
      last_edited_time: new Date().toISOString(),
    };

    this.trackRequest('POST', '/pages', { databaseId, properties, content });
    return this.pages[pageId];
  }

  // Update page
  updatePage(pageId, properties) {
    this.trackRequest('PATCH', `/pages/${pageId}`, { properties });

    if (!this.pages[pageId]) {
      throw new Error(`Page ${pageId} not found`);
    }

    this.pages[pageId].properties = {
      ...this.pages[pageId].properties,
      ...properties,
    };
    this.pages[pageId].last_edited_time = new Date().toISOString();

    return this.pages[pageId];
  }

  // Get page
  getPage(pageId) {
    this.trackRequest('GET', `/pages/${pageId}`);
    if (!this.pages[pageId]) {
      throw new Error(`Page ${pageId} not found`);
    }
    return this.pages[pageId];
  }

  // Helper: Get all pages in database
  getPagesInDatabase(databaseId) {
    return Object.values(this.pages).filter(
      page => page.parent?.database_id === databaseId
    );
  }

  // Helper: Find page by property
  findPageByProperty(databaseId, propertyName, value) {
    const pages = this.getPagesInDatabase(databaseId);
    return pages.find(page => {
      const prop = page.properties[propertyName];
      if (!prop) return false;

      // Handle different property types
      if (prop.title) {
        return prop.title[0]?.text?.content === value;
      }
      if (prop.rich_text) {
        return prop.rich_text[0]?.text?.content === value;
      }
      if (prop.number) {
        return prop.number === value;
      }
      return false;
    });
  }

  // Helper: Verify request was made
  wasRequestMade(endpoint) {
    return this.requests.some(req => req.endpoint.includes(endpoint));
  }

  // Helper: Get request count
  getRequestCount(endpoint = null) {
    if (!endpoint) return this.requests.length;
    return this.requests.filter(req => req.endpoint.includes(endpoint)).length;
  }
}

// Notion Client mock (similar to @notionhq/client)
class MockNotionClient {
  constructor(auth = {}) {
    this.auth = auth;
    this.api = mockNotionAPI;
  }

  get databases() {
    return {
      create: ({ parent, title, properties }) =>
        this.api.createDatabase(parent.page_id, title[0].text.content, properties),
      retrieve: ({ database_id }) => this.api.getDatabase(database_id),
      query: ({ database_id, filter, sorts }) =>
        this.api.queryDatabase(database_id, filter, sorts),
    };
  }

  get pages() {
    return {
      create: ({ parent, properties, children }) =>
        this.api.createPage(parent.database_id, properties, children),
      update: ({ page_id, properties }) => this.api.updatePage(page_id, properties),
      retrieve: ({ page_id }) => this.api.getPage(page_id),
    };
  }
}

// Create singleton instance
const mockNotionAPI = new MockNotionAPI();

// Export
module.exports = {
  mockNotionAPI,
  MockNotionAPI,
  MockNotionClient,

  // Setup function
  setupMockNotionAPI: () => {
    mockNotionAPI.reset();
    return mockNotionAPI;
  },

  // Cleanup function
  cleanupMockNotionAPI: () => {
    mockNotionAPI.reset();
  },

  // Property builders (helpers for creating Notion property objects)
  notionPropertyBuilders: {
    title: (text) => ({
      title: [{ text: { content: text } }],
    }),
    richText: (text) => ({
      rich_text: [{ text: { content: text } }],
    }),
    number: (num) => ({
      number: num,
    }),
    date: (start, end = null) => ({
      date: { start, end },
    }),
    checkbox: (checked) => ({
      checkbox: checked,
    }),
    select: (name) => ({
      select: { name },
    }),
    url: (url) => ({
      url,
    }),
  },
};
