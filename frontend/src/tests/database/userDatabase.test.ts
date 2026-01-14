/**
 * Database Tests - User Database Simplified Schema
 *
 * Tests for the new simplified user database schema
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { userDatabase } from '@/services/database/userDatabase';

// Test configuration
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE_KEY = import.meta.env.SUPABASE_SERVICE_ROLE_KEY ||
                    process.env.SUPABASE_SERVICE_ROLE_KEY ||
                    process.env.SUPABASE_SERVICE_KEY;

let supabase: SupabaseClient;
let testUserId: string;
const TEST_EMAIL = `test-${Date.now()}@colorado.edu`;
const TEST_STUDENT = `test${Date.now()}`;

describe('User Database - Simplified Schema', () => {
  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.warn('Skipping database tests - missing Supabase credentials');
      console.warn('SUPABASE_URL:', SUPABASE_URL ? 'present' : 'missing');
      console.warn('SERVICE_KEY:', SERVICE_KEY ? 'present' : 'missing');
      return;
    }

    // Create admin client with service role to bypass RLS
    supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  });

  afterAll(async () => {
    // Cleanup test data
    if (supabase && testUserId) {
      try {
        await supabase.from('users').delete().eq('id', testUserId);
      } catch (error) {
        console.warn('Cleanup error:', error);
      }
    }
  });

  describe('Schema Verification', () => {
    it('should have new simplified schema with required columns', async () => {
      if (!supabase) return;

      const { data: columns } = await supabase
        .rpc('exec_sql', {
          sql: `
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'users' AND table_schema = 'public'
            ORDER BY ordinal_position
          `
        });

      const columnNames = columns?.map((c: any) => c.column_name) || [];

      // Check for new schema columns
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('email');
      expect(columnNames).toContain('first_name');
      expect(columnNames).toContain('student');
      expect(columnNames).toContain('school');
      expect(columnNames).toContain('canvas_cookies');
      expect(columnNames).toContain('canvas_cookies_updated_at');
      expect(columnNames).toContain('last_login_at');
      expect(columnNames).toContain('profile_preferences');

      // Check old schema columns are gone
      expect(columnNames).not.toContain('name');
      expect(columnNames).not.toContain('numeric_id');
      expect(columnNames).not.toContain('avatar_url');
      expect(columnNames).not.toContain('profile_data');
    });

    it('should have proper foreign key constraints on related tables', async () => {
      if (!supabase) return;

      const { data: foreignKeys } = await supabase
        .rpc('exec_sql', {
          sql: `
            SELECT
              tc.table_name,
              kcu.column_name,
              ccu.table_name AS foreign_table_name,
              ccu.column_name AS foreign_column_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_name IN ('courses', 'assignments', 'sessions')
              AND ccu.table_name = 'users'
          `
        });

      expect(foreignKeys).toBeDefined();
      expect(foreignKeys!.length).toBeGreaterThan(0);

      // Check that courses, assignments, sessions all reference users
      const tables = foreignKeys!.map((fk: any) => fk.table_name);
      expect(tables).toContain('courses');
      expect(tables).toContain('assignments');
      expect(tables).toContain('sessions');
    });
  });

  describe('User CRUD Operations', () => {
    it('should create a new user with all required fields', async () => {
      const newUser = {
        email: TEST_EMAIL,
        firstName: 'Test',
        student: TEST_STUDENT,
        school: 'University of Colorado - Boulder',
        canvasCookies: [{ name: 'test', value: 'cookie' }],
        canvasCookiesUpdatedAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
        inviteCodeUsed: 'TEST123',
        onboardingCompletedAt: new Date().toISOString(),
        profilePreferences: { theme: 'dark', font: 'default' }
      };

      const createdUser = await userDatabase.createUser(newUser);

      expect(createdUser).toBeDefined();
      expect(createdUser.id).toBeDefined();
      expect(createdUser.email).toBe(TEST_EMAIL);
      expect(createdUser.firstName).toBe('Test');
      expect(createdUser.student).toBe(TEST_STUDENT);
      expect(createdUser.school).toBe('University of Colorado - Boulder');
      expect(createdUser.profilePreferences).toEqual({ theme: 'dark', font: 'default' });

      testUserId = createdUser.id;
    });

    it('should retrieve user by UUID', async () => {
      if (!testUserId) {
        console.warn('Skipping - no test user created');
        return;
      }

      const user = await userDatabase.getUser(testUserId);

      expect(user).toBeDefined();
      expect(user!.id).toBe(testUserId);
      expect(user!.email).toBe(TEST_EMAIL);
      expect(user!.student).toBe(TEST_STUDENT);
    });

    it('should retrieve user by email', async () => {
      if (!testUserId) {
        console.warn('Skipping - no test user created');
        return;
      }

      const user = await userDatabase.getUserByEmail(TEST_EMAIL);

      expect(user).toBeDefined();
      expect(user!.id).toBe(testUserId);
      expect(user!.email).toBe(TEST_EMAIL);
    });

    it('should retrieve user by student identikey', async () => {
      if (!testUserId) {
        console.warn('Skipping - no test user created');
        return;
      }

      const user = await userDatabase.getUserByStudent(TEST_STUDENT);

      expect(user).toBeDefined();
      expect(user!.id).toBe(testUserId);
      expect(user!.student).toBe(TEST_STUDENT);
    });

    it('should update user data', async () => {
      if (!testUserId) {
        console.warn('Skipping - no test user created');
        return;
      }

      const updatedUser = await userDatabase.updateUser(testUserId, {
        firstName: 'Updated Test'
      });

      expect(updatedUser).toBeDefined();
      expect(updatedUser.firstName).toBe('Updated Test');
    });

    it('should update Canvas cookies with timestamp', async () => {
      if (!testUserId) {
        console.warn('Skipping - no test user created');
        return;
      }

      const newCookies = [
        { name: 'canvas_session', value: 'new-session-value' }
      ];

      await userDatabase.updateCookies(testUserId, newCookies);

      const user = await userDatabase.getUser(testUserId);

      expect(user!.canvasCookies).toEqual(newCookies);
      expect(user!.canvasCookiesUpdatedAt).toBeDefined();
    });

    it('should update last login timestamp', async () => {
      if (!testUserId) {
        console.warn('Skipping - no test user created');
        return;
      }

      const beforeUpdate = await userDatabase.getUser(testUserId);
      const originalLastLogin = beforeUpdate!.lastLoginAt;

      // Wait a moment to ensure timestamp changes
      await new Promise(resolve => setTimeout(resolve, 1000));

      await userDatabase.updateLastLogin(testUserId);

      const afterUpdate = await userDatabase.getUser(testUserId);

      expect(afterUpdate!.lastLoginAt).toBeDefined();
      expect(afterUpdate!.lastLoginAt).not.toBe(originalLastLogin);
    });

    it('should update user preferences', async () => {
      if (!testUserId) {
        console.warn('Skipping - no test user created');
        return;
      }

      await userDatabase.updatePreferences(testUserId, {
        theme: 'light',
        fontSize: 'large'
      });

      const user = await userDatabase.getUser(testUserId);

      expect(user!.profilePreferences).toEqual({
        theme: 'light',
        font: 'default',
        fontSize: 'large'
      });
    });

    it('should check if user exists by email', async () => {
      if (!testUserId) {
        console.warn('Skipping - no test user created');
        return;
      }

      const exists = await userDatabase.userExists(TEST_EMAIL);
      expect(exists).toBe(true);

      const notExists = await userDatabase.userExists('nonexistent@colorado.edu');
      expect(notExists).toBe(false);
    });
  });

  describe('Demo User Verification', () => {
    it('should find demo user with correct schema', async () => {
      const demoUser = await userDatabase.getUserByEmail('kare6625@colorado.edu');

      if (!demoUser) {
        console.warn('Demo user not found - may not exist in test database');
        return;
      }

      // Verify demo user has new schema fields
      expect(demoUser.id).toBeDefined();
      expect(demoUser.email).toBe('kare6625@colorado.edu');
      expect(demoUser.firstName).toBeDefined();
      expect(demoUser.student).toBe('kare6625');
      expect(demoUser.school).toBeDefined();

      // Verify no old schema fields
      expect((demoUser as any).name).toBeUndefined();
      expect((demoUser as any).numeric_id).toBeUndefined();
      expect((demoUser as any).avatar_url).toBeUndefined();

      console.log('✅ Demo user verified:', {
        email: demoUser.email,
        firstName: demoUser.firstName,
        student: demoUser.student,
        lastLoginAt: demoUser.lastLoginAt
      });
    });
  });

  describe('Data Integrity', () => {
    it('should enforce unique email constraint', async () => {
      if (!testUserId) {
        console.warn('Skipping - no test user created');
        return;
      }

      const duplicateUser = {
        email: TEST_EMAIL, // Same email as test user
        firstName: 'Duplicate',
        student: 'duplicate123',
        school: 'University of Colorado - Boulder'
      };

      await expect(
        userDatabase.createUser(duplicateUser)
      ).rejects.toThrow();
    });

    it('should enforce unique student constraint', async () => {
      if (!testUserId) {
        console.warn('Skipping - no test user created');
        return;
      }

      const duplicateStudent = {
        email: `different-${Date.now()}@colorado.edu`,
        firstName: 'Different',
        student: TEST_STUDENT, // Same student as test user
        school: 'University of Colorado - Boulder'
      };

      await expect(
        userDatabase.createUser(duplicateStudent)
      ).rejects.toThrow();
    });
  });

  describe('Query Performance', () => {
    it('should retrieve users by school efficiently', async () => {
      const startTime = Date.now();

      const users = await userDatabase.getUsersBySchool('University of Colorado - Boulder');

      const endTime = Date.now();
      const queryTime = endTime - startTime;

      expect(users).toBeDefined();
      expect(Array.isArray(users)).toBe(true);
      expect(queryTime).toBeLessThan(1000); // Should complete in less than 1 second

      console.log(`Query time: ${queryTime}ms, Users found: ${users.length}`);
    });

    it('should retrieve recently active users efficiently', async () => {
      const startTime = Date.now();

      const users = await userDatabase.getRecentlyActiveUsers(10);

      const endTime = Date.now();
      const queryTime = endTime - startTime;

      expect(users).toBeDefined();
      expect(Array.isArray(users)).toBe(true);
      expect(users.length).toBeLessThanOrEqual(10);
      expect(queryTime).toBeLessThan(1000);

      console.log(`Query time: ${queryTime}ms, Active users found: ${users.length}`);
    });
  });
});
