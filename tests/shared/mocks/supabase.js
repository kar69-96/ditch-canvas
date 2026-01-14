/**
 * Mock Supabase client for testing
 * Provides in-memory database functionality without requiring a real Supabase connection
 */

class MockSupabaseClient {
  constructor() {
    this.tables = {
      users: [],
      sessions: [],
      extraction_data: [],
      chat_posts: [],
      chat_responses: [],
      chat_votes: [],
      integrations: [],
      integration_item_mappings: [],
      pending_extractions: [],
      completed_extractions: [],
      waitlist: [],
      invite_codes: [],
    };
    this.rpcCalls = [];
  }

  // Reset all data
  reset() {
    Object.keys(this.tables).forEach(table => {
      this.tables[table] = [];
    });
    this.rpcCalls = [];
  }

  // Seed table with data
  seed(tableName, data) {
    if (!this.tables[tableName]) {
      this.tables[tableName] = [];
    }
    this.tables[tableName] = [...this.tables[tableName], ...data];
  }

  // Query builder
  from(tableName) {
    const table = this.tables[tableName] || [];

    return {
      select: (columns = '*') => {
        let data = [...table];
        let error = null;
        let filters = {};

        const query = {
          eq: (column, value) => {
            filters[column] = value;
            return query;
          },
          neq: (column, value) => {
            data = data.filter(row => row[column] !== value);
            return query;
          },
          gt: (column, value) => {
            data = data.filter(row => row[column] > value);
            return query;
          },
          lt: (column, value) => {
            data = data.filter(row => row[column] < value);
            return query;
          },
          gte: (column, value) => {
            data = data.filter(row => row[column] >= value);
            return query;
          },
          lte: (column, value) => {
            data = data.filter(row => row[column] <= value);
            return query;
          },
          in: (column, values) => {
            data = data.filter(row => values.includes(row[column]));
            return query;
          },
          contains: (column, value) => {
            data = data.filter(row => {
              const rowValue = row[column];
              if (Array.isArray(rowValue)) {
                return rowValue.includes(value);
              }
              if (typeof rowValue === 'string') {
                return rowValue.includes(value);
              }
              return false;
            });
            return query;
          },
          order: (column, options = {}) => {
            const ascending = options.ascending !== false;
            data.sort((a, b) => {
              if (a[column] < b[column]) return ascending ? -1 : 1;
              if (a[column] > b[column]) return ascending ? 1 : -1;
              return 0;
            });
            return query;
          },
          limit: (count) => {
            data = data.slice(0, count);
            return query;
          },
          single: () => {
            // Apply filters
            Object.keys(filters).forEach(column => {
              data = data.filter(row => row[column] === filters[column]);
            });

            if (data.length === 0) {
              error = { message: 'No rows found', code: 'PGRST116' };
              return Promise.resolve({ data: null, error });
            }
            if (data.length > 1) {
              error = { message: 'Multiple rows found', code: 'PGRST116' };
              return Promise.resolve({ data: null, error });
            }
            return Promise.resolve({ data: data[0], error: null });
          },
          then: (resolve) => {
            // Apply filters
            Object.keys(filters).forEach(column => {
              data = data.filter(row => row[column] === filters[column]);
            });
            return resolve({ data, error });
          },
        };

        return query;
      },

      insert: (records) => {
        const recordsArray = Array.isArray(records) ? records : [records];
        const insertedRecords = recordsArray.map(record => ({
          id: record.id || Math.random().toString(36).substring(7),
          created_at: record.created_at || new Date().toISOString(),
          updated_at: record.updated_at || new Date().toISOString(),
          ...record,
        }));

        table.push(...insertedRecords);
        this.tables[tableName] = table;

        return {
          select: () => ({
            single: () => Promise.resolve({
              data: insertedRecords[0],
              error: null
            }),
            then: (resolve) => resolve({ data: insertedRecords, error: null }),
          }),
          then: (resolve) => resolve({ data: insertedRecords, error: null }),
        };
      },

      update: (updates) => {
        let filters = {};

        const query = {
          eq: (column, value) => {
            filters[column] = value;
            return query;
          },
          then: (resolve) => {
            const matchingIndices = [];
            table.forEach((row, index) => {
              let matches = true;
              Object.keys(filters).forEach(column => {
                if (row[column] !== filters[column]) {
                  matches = false;
                }
              });
              if (matches) {
                matchingIndices.push(index);
              }
            });

            matchingIndices.forEach(index => {
              table[index] = {
                ...table[index],
                ...updates,
                updated_at: new Date().toISOString(),
              };
            });

            this.tables[tableName] = table;
            const updatedRecords = matchingIndices.map(i => table[i]);
            return resolve({ data: updatedRecords, error: null });
          },
          select: () => ({
            then: (resolve) => {
              const matchingIndices = [];
              table.forEach((row, index) => {
                let matches = true;
                Object.keys(filters).forEach(column => {
                  if (row[column] !== filters[column]) {
                    matches = false;
                  }
                });
                if (matches) {
                  matchingIndices.push(index);
                }
              });

              matchingIndices.forEach(index => {
                table[index] = {
                  ...table[index],
                  ...updates,
                  updated_at: new Date().toISOString(),
                };
              });

              this.tables[tableName] = table;
              const updatedRecords = matchingIndices.map(i => table[i]);
              return resolve({ data: updatedRecords, error: null });
            },
          }),
        };

        return query;
      },

      delete: () => {
        let filters = {};

        const query = {
          eq: (column, value) => {
            filters[column] = value;
            return query;
          },
          then: (resolve) => {
            const remainingRows = table.filter(row => {
              let matches = true;
              Object.keys(filters).forEach(column => {
                if (row[column] !== filters[column]) {
                  matches = false;
                }
              });
              return !matches;
            });

            this.tables[tableName] = remainingRows;
            return resolve({ data: null, error: null });
          },
        };

        return query;
      },
    };
  }

  // RPC function call
  rpc(functionName, params = {}) {
    this.rpcCalls.push({ functionName, params });

    // Mock get_user_entities RPC
    if (functionName === 'get_user_entities') {
      const { user_email, entity_type_filter, course_id_filter } = params;
      let data = this.tables.extraction_data.filter(
        row => row.user_email === user_email
      );

      if (entity_type_filter) {
        data = data.filter(row => row.entity_type === entity_type_filter);
      }

      if (course_id_filter) {
        data = data.filter(row => row.course_id === course_id_filter);
      }

      return Promise.resolve({ data, error: null });
    }

    // Mock upsert_user_entity RPC
    if (functionName === 'upsert_user_entity') {
      const { user_email, entity_type, entity_id, course_id, entity_data, entity_metadata } = params;

      const existingIndex = this.tables.extraction_data.findIndex(
        row =>
          row.user_email === user_email &&
          row.entity_type === entity_type &&
          row.entity_id === entity_id &&
          row.course_id === course_id
      );

      const record = {
        user_email,
        entity_type,
        entity_id,
        course_id: course_id || '',
        data: entity_data || {},
        metadata: entity_metadata || {},
        updated_at: new Date().toISOString(),
      };

      if (existingIndex >= 0) {
        this.tables.extraction_data[existingIndex] = {
          ...this.tables.extraction_data[existingIndex],
          ...record,
        };
      } else {
        record.id = Math.random().toString(36).substring(7);
        record.created_at = new Date().toISOString();
        this.tables.extraction_data.push(record);
      }

      return Promise.resolve({ data: record, error: null });
    }

    // Default: return empty result
    return Promise.resolve({ data: null, error: null });
  }

  // Auth mock
  auth = {
    getSession: () => Promise.resolve({
      data: {
        session: {
          user: { email: 'test@colorado.edu' },
          access_token: 'mock-token',
        },
      },
      error: null,
    }),
    signInWithPassword: ({ email, password }) => Promise.resolve({
      data: {
        user: { email },
        session: { access_token: 'mock-token' },
      },
      error: null,
    }),
    signOut: () => Promise.resolve({ error: null }),
  };
}

// Create singleton instance
const mockSupabase = new MockSupabaseClient();

module.exports = {
  createClient: () => mockSupabase,
  mockSupabase,
  MockSupabaseClient,
};
