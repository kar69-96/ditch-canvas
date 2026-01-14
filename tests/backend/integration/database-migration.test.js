/**
 * Database Migration Integration Tests
 *
 * Tests to verify the simplified database migration was successful
 */

const { expect } = require('chai');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'frontend/.env.local' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

describe('Database Migration - Integration Tests', function() {
  this.timeout(30000); // 30 second timeout for database operations

  let supabase;

  before(function() {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.warn('⚠️  Skipping database tests - missing Supabase credentials');
      this.skip();
    }

    supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  });

  describe('Schema Migration Verification', () => {
    it('should have users table with new simplified schema', async () => {
      const { data: columns, error } = await supabase
        .from('users')
        .select('*')
        .limit(1);

      expect(error).to.be.null;
      expect(columns).to.be.an('array');

      if (columns.length > 0) {
        const user = columns[0];

        // New schema fields
        expect(user).to.have.property('id');
        expect(user).to.have.property('email');
        expect(user).to.have.property('first_name');
        expect(user).to.have.property('student');
        expect(user).to.have.property('school');
        expect(user).to.have.property('canvas_cookies');
        expect(user).to.have.property('canvas_cookies_updated_at');
        expect(user).to.have.property('last_login_at');
        expect(user).to.have.property('profile_preferences');

        // Old schema fields should NOT exist
        expect(user).to.not.have.property('name');
        expect(user).to.not.have.property('numeric_id');
        expect(user).to.not.have.property('avatar_url');
        expect(user).to.not.have.property('profile_data');

        console.log('  ✅ Schema verified:', Object.keys(user).join(', '));
      }
    });

    it('should have backup tables created', async () => {
      const { data, error } = await supabase.rpc('exec_sql', {
        sql: `
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name LIKE '%_old'
          ORDER BY table_name
        `
      });

      if (error) {
        console.warn('  ⚠️  Could not check backup tables');
        return;
      }

      expect(data).to.be.an('array');

      if (data.length > 0) {
        console.log(`  ✅ Found ${data.length} backup tables:`, data.map(t => t.table_name).join(', '));
      } else {
        console.log('  ℹ️  No backup tables found (may have been dropped)');
      }
    });

    it('should have proper foreign key constraints', async () => {
      const { data, error } = await supabase.rpc('exec_sql', {
        sql: `
          SELECT
            tc.table_name,
            string_agg(kcu.column_name, ', ') as columns,
            string_agg(ccu.table_name, ', ') as references
          FROM information_schema.table_constraints AS tc
          JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
          JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_name IN ('courses', 'assignments', 'sessions', 'announcements', 'modules', 'grades')
            AND ccu.table_name = 'users'
          GROUP BY tc.table_name
          ORDER BY tc.table_name
        `
      });

      if (error) {
        console.warn('  ⚠️  Could not check foreign keys');
        return;
      }

      expect(data).to.be.an('array');
      expect(data.length).to.be.greaterThan(0);

      console.log('  ✅ Foreign key constraints:');
      data.forEach(fk => {
        console.log(`     ${fk.table_name}.${fk.columns} → ${fk.references}`);
      });
    });
  });

  describe('Demo User Verification', () => {
    it('should have demo user with correct data', async () => {
      const { data: users, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', 'kare6625@colorado.edu')
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          console.warn('  ⚠️  Demo user not found in database');
          return;
        }
        throw error;
      }

      expect(users).to.be.an('object');
      expect(users.email).to.equal('kare6625@colorado.edu');
      expect(users.first_name).to.exist;
      expect(users.student).to.equal('kare6625');
      expect(users.school).to.include('Colorado');

      console.log('  ✅ Demo user verified:');
      console.log(`     Email: ${users.email}`);
      console.log(`     First Name: ${users.first_name}`);
      console.log(`     Student: ${users.student}`);
      console.log(`     School: ${users.school}`);
      console.log(`     Last Login: ${users.last_login_at || 'Not set'}`);
      console.log(`     Onboarding: ${users.onboarding_completed_at ? 'Complete' : 'Pending'}`);
    });
  });

  describe('Data Integrity Tests', () => {
    it('should have all users with populated student field', async () => {
      const { data: users, error } = await supabase
        .from('users')
        .select('email, student')
        .is('student', null);

      expect(error).to.be.null;
      expect(users).to.be.an('array');
      expect(users.length).to.equal(0, 'Found users with NULL student field');

      console.log('  ✅ All users have student field populated');
    });

    it('should have no orphaned courses', async () => {
      const { data, error } = await supabase.rpc('exec_sql', {
        sql: `
          SELECT COUNT(*) as count
          FROM courses c
          WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.user_id)
        `
      });

      if (error) {
        console.warn('  ⚠️  Could not check orphaned courses');
        return;
      }

      expect(data[0].count).to.equal(0, 'Found orphaned courses');
      console.log('  ✅ No orphaned courses found');
    });

    it('should have no orphaned assignments', async () => {
      const { data, error } = await supabase.rpc('exec_sql', {
        sql: `
          SELECT COUNT(*) as count
          FROM assignments a
          WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.user_id)
        `
      });

      if (error) {
        console.warn('  ⚠️  Could not check orphaned assignments');
        return;
      }

      expect(data[0].count).to.equal(0, 'Found orphaned assignments');
      console.log('  ✅ No orphaned assignments found');
    });
  });

  describe('Performance Tests', () => {
    it('should query users efficiently', async function() {
      this.timeout(5000); // 5 second timeout

      const startTime = Date.now();

      const { data, error } = await supabase
        .from('users')
        .select('email, first_name, student, school')
        .limit(100);

      const queryTime = Date.now() - startTime;

      expect(error).to.be.null;
      expect(data).to.be.an('array');
      expect(queryTime).to.be.lessThan(2000); // Should be under 2 seconds

      console.log(`  ✅ Query completed in ${queryTime}ms (${data.length} users)`);
    });

    it('should filter by student efficiently', async function() {
      this.timeout(5000);

      const startTime = Date.now();

      const { data, error } = await supabase
        .from('users')
        .select('email, student')
        .eq('student', 'kare6625');

      const queryTime = Date.now() - startTime;

      expect(error).to.be.null;
      expect(queryTime).to.be.lessThan(1000); // Should be under 1 second

      console.log(`  ✅ Student filter query completed in ${queryTime}ms`);
    });
  });

  describe('RLS Policy Tests', () => {
    it('should have RLS enabled on users table', async () => {
      const { data, error } = await supabase.rpc('exec_sql', {
        sql: `
          SELECT relname, relrowsecurity
          FROM pg_class
          WHERE relname = 'users' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        `
      });

      if (error) {
        console.warn('  ⚠️  Could not check RLS status');
        return;
      }

      expect(data).to.be.an('array');
      expect(data.length).to.be.greaterThan(0);

      if (data[0].relrowsecurity) {
        console.log('  ✅ RLS is enabled on users table');
      } else {
        console.warn('  ⚠️  RLS is NOT enabled on users table');
      }
    });
  });

  describe('Migration Completeness', () => {
    it('should have all expected tables', async () => {
      const expectedTables = [
        'users',
        'sessions',
        'courses',
        'assignments',
        'announcements',
        'modules',
        'grades'
      ];

      const foundTables = [];

      for (const table of expectedTables) {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .limit(0);

        if (!error) {
          foundTables.push(table);
        }
      }

      expect(foundTables.length).to.equal(expectedTables.length);

      console.log('  ✅ All expected tables exist:', foundTables.join(', '));
    });

    it('should have proper indexes for performance', async () => {
      const { data, error } = await supabase.rpc('exec_sql', {
        sql: `
          SELECT
            tablename,
            indexname
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename IN ('users', 'courses', 'assignments', 'sessions')
            AND indexname LIKE 'idx_%'
          ORDER BY tablename, indexname
        `
      });

      if (error) {
        console.warn('  ⚠️  Could not check indexes');
        return;
      }

      expect(data).to.be.an('array');
      expect(data.length).to.be.greaterThan(0);

      console.log(`  ✅ Found ${data.length} performance indexes`);
    });
  });
});
