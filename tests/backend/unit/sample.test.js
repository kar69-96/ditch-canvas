/**
 * Sample test to verify test infrastructure works
 */

const assert = require('assert');

describe('Test Infrastructure', () => {
  describe('Basic assertions', () => {
    it('should pass a simple assertion', () => {
      assert.strictEqual(1 + 1, 2);
    });

    it('should work with async functions', async () => {
      const result = await Promise.resolve(42);
      assert.strictEqual(result, 42);
    });
  });

  describe('Array operations', () => {
    it('should include an element', () => {
      const arr = [1, 2, 3];
      assert(arr.includes(2));
    });

    it('should have correct length', () => {
      const arr = ['a', 'b', 'c'];
      assert.strictEqual(arr.length, 3);
    });
  });
});
