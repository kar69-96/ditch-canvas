# YAY_FINAL Test Suite

Comprehensive test suite with unit, integration, and E2E tests for both backend and frontend.

## Overview

The test suite provides 100+ tests covering:
- **Backend**: Unit, Integration, and E2E tests (Mocha + Supertest)
- **Frontend**: Component, Integration, and E2E tests (Vitest + Testing Library)
- **Mocking**: In-memory Supabase, file system, Canvas API, and integrations
- **Fixtures**: Static test data for common scenarios
- **Factories**: Dynamic test data generation with realistic values

## Test Structure

```
tests/
├── backend/
│   ├── unit/           # Unit tests (routes, services, utilities)
│   ├── integration/    # Integration tests (cross-service flows)
│   ├── e2e/           # End-to-end tests (full user journeys)
│   └── fixtures/      # Static test data
├── frontend/
│   ├── unit/          # Component and hook tests
│   ├── integration/   # Service integration tests
│   └── e2e/          # Full user flow tests
├── shared/
│   ├── mocks/        # Mock implementations (Supabase, fs, Canvas API)
│   ├── fixtures/     # Shared test data
│   ├── factories/    # Test data generators
│   └── helpers/      # Test utilities
└── README.md         # This file
```

## Running Tests

### All Tests
```bash
npm test                    # Run all backend and frontend tests
npm run test:all           # Alternative
```

### Backend Tests
```bash
npm run test:backend                   # All backend tests
npm run test:backend:unit             # Unit tests only
npm run test:backend:integration      # Integration tests only
npm run test:backend:e2e             # E2E tests only
npm run test:backend:watch           # Watch mode
npm run test:backend:coverage        # With coverage report
```

### Frontend Tests
```bash
npm run test:frontend                  # All frontend tests
cd frontend && npm run test:unit      # Unit tests only
cd frontend && npm run test:watch     # Watch mode
cd frontend && npm run test:coverage  # With coverage
```

### Coverage Reports
```bash
npm run test:coverage     # Generate coverage for both backend and frontend
```

Coverage reports are generated in:
- Backend: `./coverage/`
- Frontend: `./frontend/coverage/`

## Test Categories

### Backend Unit Tests (80+ tests)

**Routes** (`tests/backend/unit/routes/`)
- `onboarding.test.js` - 23 tests covering all onboarding endpoints
- `assignments.test.js` - 18 tests for assignment CRUD and completion
- `integrations.test.js` - 30 tests for OAuth and sync operations

**Services** (`tests/backend/unit/services/`)
- `sync-orchestrator.test.js` - Multi-integration sync coordination
- `google-sheets-sync.test.js` - Google Sheets API integration
- `notion-sync.test.js` - Notion API integration
- `token-crypto.test.js` - Token encryption/decryption
- `overrides-service.test.js` - Assignment override management

**Utilities** (`tests/backend/unit/utils/`)
- `cookie-helpers.test.js` - Cookie file management
- Other utility functions

### Backend Integration Tests (10+ tests)

**Cross-Service Flows** (`tests/backend/integration/`)
- `onboarding-flow.test.js` - Complete onboarding from start to finish
- `assignment-sync.test.js` - Assignment completion → Integration sync
- `streaming-auth-api.test.js` - Streaming authentication flow
- `assignments-api.test.js` - Assignment API integration

### Backend E2E Tests (5+ tests)

**Full System Tests** (`tests/backend/e2e/`)
- User onboarding journey (sign up → auth → extraction → login)
- Assignment management (view → mark complete → sync)
- Integration setup (OAuth → sync → verify)

### Frontend Tests

**Component Tests** (`frontend/src/__tests__/`)
- Layout, navigation, and routing
- Form components and validation
- Data display components

**Integration Tests**
- API service integration
- State management flows
- Authentication flows

## Mocking Strategy

### Supabase Mock (`tests/shared/mocks/supabase.js`)
- In-memory database simulation
- Full CRUD operations
- RPC function support
- Query filtering and ordering

### File System Mock (`tests/shared/mocks/fs.js`)
- In-memory file system (memfs)
- Cookie file management
- Override file handling

### Canvas API Mock (`tests/shared/mocks/canvas-api.js`)
- Realistic HTML responses
- JSON API responses
- Mock courses, assignments, modules

## Test Data

### Fixtures (Static Data)
Located in `tests/backend/fixtures/`:
- `users.js` - Sample users with various states
- `courses.js` - Mock courses (active, completed, unpublished)
- `assignments.js` - Various assignment scenarios
- `chat.js` - Chat posts, responses, votes
- `integrations.js` - Integration configs and mappings

### Factories (Dynamic Data)
Located in `tests/shared/factories/`:
- `userFactory.js` - Generate users with faker.js
- `courseFactory.js` - Generate courses
- `assignmentFactory.js` - Generate assignments
- `chatFactory.js` - Generate chat data

## Writing New Tests

### Backend Test Template
```javascript
const assert = require('assert');
const request = require('supertest');
const { mockSupabase } = require('../../../shared/mocks/supabase');

describe('Feature Name', () => {
  beforeEach(() => {
    mockSupabase.reset();
    // Seed test data
    mockSupabase.seed('users', [/* test users */]);
  });

  afterEach(() => {
    mockSupabase.reset();
  });

  it('should do something', async () => {
    const response = await request(app)
      .get('/api/endpoint')
      .send({ data: 'test' });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
  });
});
```

### Frontend Test Template
```typescript
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

describe('Component Name', () => {
  it('should render correctly', () => {
    render(<Component />);
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });
});
```

## Coverage Thresholds

### Backend
- Branches: 70%
- Functions: 70%
- Lines: 70%
- Statements: 70%

### Frontend
- Branches: 80%
- Functions: 80%
- Lines: 80%
- Statements: 80%

## Best Practices

1. **Reset Mocks**: Always reset mocks in `beforeEach` and `afterEach`
2. **Seed Data**: Use fixtures for static data, factories for dynamic data
3. **Test Isolation**: Each test should be independent
4. **Descriptive Names**: Use clear, descriptive test names
5. **Arrange-Act-Assert**: Follow AAA pattern
6. **Mock External Services**: Never call real APIs in tests
7. **Coverage**: Aim for high coverage but prioritize meaningful tests
8. **Watch Mode**: Use watch mode during development

## Continuous Integration

Tests run automatically on:
- Every commit (pre-commit hook)
- Every pull request
- Daily scheduled runs

## Troubleshooting

### Tests Running Slowly
- Use `--timeout` flag to increase timeout for integration/E2E tests
- Consider splitting large test files
- Use `.only` to run specific tests during development

### Mocks Not Working
- Verify mock setup in `beforeEach`
- Check that mocks are reset between tests
- Ensure correct import paths

### Coverage Issues
- Check `.c8rc.json` for exclusion patterns
- Verify test files are in correct directories
- Run with `--reporter=text` for detailed output

## Resources

- [Mocha Documentation](https://mochajs.org/)
- [Vitest Documentation](https://vitest.dev/)
- [Supertest Documentation](https://github.com/visionmedia/supertest)
- [Testing Library](https://testing-library.com/)

## Maintenance

- Update fixtures when data structures change
- Add tests for new features
- Keep coverage thresholds up to date
- Review and refactor flaky tests
- Update mocks when external APIs change
