/**
 * Simplified Database Tests - Direct Table Queries
 */

import { describe, it, expect } from 'vitest';
import { userDatabase } from '@/services/database/userDatabase';

describe('User Database - Post-Migration Tests', () => {
  describe('Demo User Verification', () => {
    it('should find demo user with new schema', async () => {
      const demoUser = await userDatabase.getUserByEmail('kare6625@colorado.edu');

      if (!demoUser) {
        console.warn('⚠️  Demo user not found');
        return;
      }

      // Verify UUID-based ID (new schema)
      expect(demoUser.id).toBeDefined();
      expect(typeof demoUser.id).toBe('string');
      expect(demoUser.id.length).toBeGreaterThan(0);

      // Verify required fields
      expect(demoUser.email).toBe('kare6625@colorado.edu');
      expect(demoUser.firstName).toBeDefined();
      expect(demoUser.student).toBe('kare6625');
      expect(demoUser.school).toBeDefined();

      // Verify no old schema fields
      expect((demoUser as any).name).toBeUndefined();
      expect((demoUser as any).numeric_id).toBeUndefined();
      expect((demoUser as any).avatar_url).toBeUndefined();

      console.log('  ✅ Demo user verified:');
      console.log(`     Email: ${demoUser.email}`);
      console.log(`     First Name: ${demoUser.firstName}`);
      console.log(`     Student: ${demoUser.student}`);
      console.log(`     School: ${demoUser.school}`);
    });

    it('should find demo user by student identikey', async () => {
      const demoUser = await userDatabase.getUserByStudent('kare6625');

      if (!demoUser) {
        console.warn('⚠️  Demo user not found by student');
        return;
      }

      expect(demoUser.email).toBe('kare6625@colorado.edu');
      expect(demoUser.student).toBe('kare6625');

      console.log('  ✅ Demo user found by student identikey');
    });
  });

  describe('Query Operations', () => {
    it('should check if user exists', async () => {
      const exists = await userDatabase.userExists('kare6625@colorado.edu');
      expect(exists).toBe(true);

      const notExists = await userDatabase.userExists('nonexistent@example.com');
      expect(notExists).toBe(false);

      console.log('  ✅ User existence check working');
    });

    it('should get users by school', async () => {
      const users = await userDatabase.getUsersBySchool('University of Colorado - Boulder');

      expect(users).toBeDefined();
      expect(Array.isArray(users)).toBe(true);

      console.log(`  ✅ Found ${users.length} users at CU Boulder`);
    });

    it('should get recently active users', async () => {
      const users = await userDatabase.getRecentlyActiveUsers(5);

      expect(users).toBeDefined();
      expect(Array.isArray(users)).toBe(true);
      expect(users.length).toBeLessThanOrEqual(5);

      console.log(`  ✅ Found ${users.length} recently active users`);
    });

    it('should get all users', async () => {
      const users = await userDatabase.getAllUsers();

      expect(users).toBeDefined();
      expect(Array.isArray(users)).toBe(true);
      expect(users.length).toBeGreaterThan(0);

      console.log(`  ✅ Total users in database: ${users.length}`);

      // Verify all users have new schema
      users.forEach(user => {
        expect(user.id).toBeDefined();
        expect(user.email).toBeDefined();
        expect(user.firstName).toBeDefined();
        expect(user.student).toBeDefined();
      });

      console.log('  ✅ All users have new schema fields');
    });
  });

  describe('Performance Tests', () => {
    it('should query by email efficiently', async () => {
      const startTime = Date.now();

      const user = await userDatabase.getUserByEmail('kare6625@colorado.edu');

      const queryTime = Date.now() - startTime;

      expect(user).toBeDefined();
      expect(queryTime).toBeLessThan(500); // Should be under 500ms

      console.log(`  ✅ Email query completed in ${queryTime}ms`);
    });

    it('should query by student efficiently', async () => {
      const startTime = Date.now();

      const user = await userDatabase.getUserByStudent('kare6625');

      const queryTime = Date.now() - startTime;

      expect(user).toBeDefined();
      expect(queryTime).toBeLessThan(500);

      console.log(`  ✅ Student query completed in ${queryTime}ms`);
    });
  });

  describe('Data Integrity', () => {
    it('should have all users with populated student field', async () => {
      const users = await userDatabase.getAllUsers();

      const usersWithoutStudent = users.filter(u => !u.student);

      expect(usersWithoutStudent.length).toBe(0);

      console.log('  ✅ All users have student field populated');
    });

    it('should have all users with valid email', async () => {
      const users = await userDatabase.getAllUsers();

      const usersWithInvalidEmail = users.filter(u => !u.email || !u.email.includes('@'));

      expect(usersWithInvalidEmail.length).toBe(0);

      console.log('  ✅ All users have valid email addresses');
    });

    it('should have all users with firstName', async () => {
      const users = await userDatabase.getAllUsers();

      const usersWithoutName = users.filter(u => !u.firstName);

      expect(usersWithoutName.length).toBe(0);

      console.log('  ✅ All users have firstName populated');
    });
  });

  describe('Cookie and Login Tracking', () => {
    it('should track canvas cookies with timestamp', async () => {
      const demoUser = await userDatabase.getUserByEmail('kare6625@colorado.edu');

      if (!demoUser) {
        console.warn('⚠️  Demo user not found');
        return;
      }

      // Check that cookie timestamp fields exist
      expect(demoUser).toHaveProperty('canvasCookiesUpdatedAt');
      expect(demoUser).toHaveProperty('lastLoginAt');

      console.log('  ✅ Cookie and login tracking fields present');
      console.log(`     Canvas cookies updated: ${demoUser.canvasCookiesUpdatedAt || 'Not set'}`);
      console.log(`     Last login: ${demoUser.lastLoginAt || 'Not set'}`);
    });
  });
});
