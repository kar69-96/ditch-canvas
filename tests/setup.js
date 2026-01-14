/**
 * Global test setup for backend tests
 * Runs before all tests to configure the test environment
 */

// Set NODE_ENV to test
process.env.NODE_ENV = 'test';

// Suppress console output during tests (optional - uncomment if needed)
// global.console = {
//   ...console,
//   log: () => {},
//   info: () => {},
//   warn: () => {},
//   error: () => {},
// };

// Global test helpers
global.wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

console.log('Test environment initialized');
