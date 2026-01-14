/**
 * Mock Google Sheets API for testing
 * Provides mock responses for Google Sheets integration
 */

class MockGoogleSheetsAPI {
  constructor() {
    this.spreadsheets = {};
    this.requests = [];
  }

  // Reset all data
  reset() {
    this.spreadsheets = {};
    this.requests = [];
  }

  // Track API request
  trackRequest(method, endpoint, data = {}) {
    this.requests.push({ method, endpoint, data, timestamp: Date.now() });
  }

  // Create spreadsheet
  createSpreadsheet(title, sheets = []) {
    const spreadsheetId = `sheet_${Math.random().toString(36).substring(7)}`;
    this.spreadsheets[spreadsheetId] = {
      spreadsheetId,
      properties: { title },
      sheets: sheets.map((sheetTitle, index) => ({
        properties: {
          sheetId: index,
          title: sheetTitle,
          index,
          gridProperties: { rowCount: 1000, columnCount: 26 },
        },
        data: [],
      })),
    };

    this.trackRequest('POST', '/spreadsheets', { title, sheets });
    return { data: this.spreadsheets[spreadsheetId] };
  }

  // Get spreadsheet
  getSpreadsheet(spreadsheetId) {
    this.trackRequest('GET', `/spreadsheets/${spreadsheetId}`);
    if (!this.spreadsheets[spreadsheetId]) {
      throw new Error(`Spreadsheet ${spreadsheetId} not found`);
    }
    return { data: this.spreadsheets[spreadsheetId] };
  }

  // Append values to sheet
  appendValues(spreadsheetId, range, values) {
    this.trackRequest('POST', `/spreadsheets/${spreadsheetId}/values:append`, {
      range,
      values,
    });

    if (!this.spreadsheets[spreadsheetId]) {
      throw new Error(`Spreadsheet ${spreadsheetId} not found`);
    }

    // Find the sheet
    const sheetName = range.split('!')[0];
    const sheet = this.spreadsheets[spreadsheetId].sheets.find(
      s => s.properties.title === sheetName
    );

    if (!sheet) {
      throw new Error(`Sheet ${sheetName} not found`);
    }

    // Append values
    if (!sheet.data) {
      sheet.data = [];
    }
    sheet.data.push(...values);

    return {
      data: {
        spreadsheetId,
        updates: {
          spreadsheetId,
          updatedRange: range,
          updatedRows: values.length,
          updatedColumns: values[0]?.length || 0,
          updatedCells: values.reduce((sum, row) => sum + row.length, 0),
        },
      },
    };
  }

  // Update values
  updateValues(spreadsheetId, range, values) {
    this.trackRequest('PUT', `/spreadsheets/${spreadsheetId}/values`, {
      range,
      values,
    });

    if (!this.spreadsheets[spreadsheetId]) {
      throw new Error(`Spreadsheet ${spreadsheetId} not found`);
    }

    return {
      data: {
        spreadsheetId,
        updatedRange: range,
        updatedRows: values.length,
        updatedColumns: values[0]?.length || 0,
        updatedCells: values.reduce((sum, row) => sum + row.length, 0),
      },
    };
  }

  // Batch update
  batchUpdate(spreadsheetId, requests) {
    this.trackRequest('POST', `/spreadsheets/${spreadsheetId}:batchUpdate`, {
      requests,
    });

    if (!this.spreadsheets[spreadsheetId]) {
      throw new Error(`Spreadsheet ${spreadsheetId} not found`);
    }

    return {
      data: {
        spreadsheetId,
        replies: requests.map(() => ({})),
      },
    };
  }

  // Helper: Get sheet data
  getSheetData(spreadsheetId, sheetName) {
    const spreadsheet = this.spreadsheets[spreadsheetId];
    if (!spreadsheet) return null;

    const sheet = spreadsheet.sheets.find(
      s => s.properties.title === sheetName
    );
    return sheet?.data || [];
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

// OAuth2 client mock
class MockGoogleOAuth2Client {
  constructor(credentials = {}) {
    this.credentials = credentials;
  }

  setCredentials(credentials) {
    this.credentials = credentials;
  }

  getAccessToken() {
    return Promise.resolve({
      token: this.credentials.access_token || 'mock-access-token',
    });
  }

  refreshAccessToken() {
    return Promise.resolve({
      credentials: {
        access_token: 'refreshed-mock-token',
        refresh_token: this.credentials.refresh_token,
        expiry_date: Date.now() + 3600000,
      },
    });
  }
}

// Create singleton instance
const mockGoogleSheetsAPI = new MockGoogleSheetsAPI();

// Export
module.exports = {
  mockGoogleSheetsAPI,
  MockGoogleSheetsAPI,
  MockGoogleOAuth2Client,

  // Setup function
  setupMockGoogleAPI: () => {
    mockGoogleSheetsAPI.reset();
    return mockGoogleSheetsAPI;
  },

  // Cleanup function
  cleanupMockGoogleAPI: () => {
    mockGoogleSheetsAPI.reset();
  },

  // Create mock google object similar to googleapis
  mockGoogle: {
    sheets: (version) => ({
      spreadsheets: {
        create: (params) =>
          mockGoogleSheetsAPI.createSpreadsheet(
            params.requestBody.properties.title,
            params.requestBody.sheets?.map(s => s.properties.title) || []
          ),
        get: (params) => mockGoogleSheetsAPI.getSpreadsheet(params.spreadsheetId),
        values: {
          append: (params) =>
            mockGoogleSheetsAPI.appendValues(
              params.spreadsheetId,
              params.range,
              params.requestBody.values
            ),
          update: (params) =>
            mockGoogleSheetsAPI.updateValues(
              params.spreadsheetId,
              params.range,
              params.requestBody.values
            ),
        },
        batchUpdate: (params) =>
          mockGoogleSheetsAPI.batchUpdate(
            params.spreadsheetId,
            params.requestBody.requests
          ),
      },
    }),
    auth: {
      OAuth2: MockGoogleOAuth2Client,
    },
  },
};
