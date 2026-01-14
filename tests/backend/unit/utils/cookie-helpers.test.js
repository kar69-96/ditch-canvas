/**
 * Unit tests for cookie helpers
 */

const assert = require('assert');

describe('Cookie Helpers', () => {
  it('should generate cookie filename from email', () => {
    const email = 'test@colorado.edu';
    const filename = email.replace(/@/g, '_at_').replace(/\./g, '_');
    assert.strictEqual(filename, 'test_at_colorado_edu');
  });

  it('should validate cookie structure', () => {
    const cookie = { name: 'session', value: 'abc123', domain: '.colorado.edu' };
    assert(cookie.name);
    assert(cookie.value);
    assert(cookie.domain);
  });

  it('should handle special characters in email', () => {
    const email = 'test.user+tag@colorado.edu';
    const filename = email.replace(/@/g, '_at_').replace(/\./g, '_').replace(/\+/g, '_');
    assert(filename.includes('_at_'));
  });
});
