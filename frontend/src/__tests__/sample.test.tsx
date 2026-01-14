/**
 * Sample test to verify frontend test infrastructure works
 */

import { describe, it, expect } from 'vitest';

describe('Frontend Test Infrastructure', () => {
  describe('Basic assertions', () => {
    it('should pass a simple assertion', () => {
      expect(1 + 1).toBe(2);
    });

    it('should work with async functions', async () => {
      const result = await Promise.resolve(42);
      expect(result).toBe(42);
    });
  });

  describe('Array operations', () => {
    it('should include an element', () => {
      const arr = [1, 2, 3];
      expect(arr).toContain(2);
    });

    it('should have correct length', () => {
      const arr = ['a', 'b', 'c'];
      expect(arr).toHaveLength(3);
    });
  });
});
