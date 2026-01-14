# Supabase Schema Migration Guide
## From Per-User Tables to Unified Storage (January 2026)

This document explains the Supabase schema consolidation that simplifies and improves maintainability while preserving all existing data.

---

## What Changed

### Before (Old Schema)
- Created separate `user_{email}_data` table for each user
- Example: `user_john_at_colorado_edu_data`, `user_jane_at_colorado_edu_data`, etc.
- Unbounded table growth (1 table per user)
- Complex query planning with thousands of tables
- Hard to do cross-user analytics

### After (New Schema)
- Single unified `extraction_data` table for all users
- User isolation via `user_email` column
- Row Level Security (RLS) policies enforce data access
- Better performance with proper indexes
- Easier maintenance and backups

---

## Migration Files Created

All migration files are in `frontend/supabase/migrations/`:

1. **`20260109000000_consolidate_extraction_data.sql`**
   Creates the unified `extraction_data` table with indexes and RLS

2. **`20260109000001_migrate_per_user_tables.sql`**
   Migration function to copy data from old per-user tables

3. **`20260109000002_update_rpc_functions.sql`**
   Updates `get_user_entities()` and `upsert_user_entity()` RPC functions

4. **`20260109000003_add_missing_indexes.sql`**
   Adds performance indexes to chat, integrations, sessions, extraction queue

5. **`20260109000004_improve_rls_policies.sql`**
   Documents improved RLS policies (not enabled, for future reference)

6. **`20260109000005_deprecate_old_functions.sql`**
   Marks old per-user table functions as deprecated

---

## How to Apply the Migration

### Step 1: Backup Your Database

```bash
cd frontend
npx supabase db dump --schema public > backup-$(date +%Y%m%d).sql
```

**Store this backup safely!** You can restore with:
```bash
psql -h your-db-host -U postgres -d your-db-name < backup-20260109.sql
```

### Step 2: Apply Migrations Sequentially

```bash
cd frontend

# Apply Phase 1: Create unified table
npx supabase db push

# This will apply:
# - 20260109000000_consolidate_extraction_data.sql
# - 20260109000001_migrate_per_user_tables.sql
# - 20260109000002_update_rpc_functions.sql
# - 20260109000003_add_missing_indexes.sql
# - 20260109000004_improve_rls_policies.sql
# - 20260109000005_deprecate_old_functions.sql
```

### Step 3: Run Data Migration Function

**IMPORTANT:** This step migrates data from old per-user tables to the new unified table.

Open your Supabase SQL Editor and run:

```sql
SELECT * FROM migrate_user_data_to_unified();
```

This will return:
```
migrated_users | total_rows_migrated
---------------|--------------------
           5   |              12,543
```

**Expected time:** ~1-5 minutes for most databases (depends on data size)

### Step 4: Verify Data Migration

Check that all users have data in the new table:

```sql
-- Count entities per user in new table
SELECT user_email, entity_type, count(*) as count
FROM extraction_data
GROUP BY user_email, entity_type
ORDER BY user_email, entity_type;

-- Compare old vs new for a specific user
SELECT 'Old table' as source, count(*) as cnt
FROM user_john_at_colorado_edu_data
UNION ALL
SELECT 'New table', count(*)
FROM extraction_data
WHERE user_email = 'john@colorado.edu';
```

Both counts should match!

### Step 5: Test Application

1. **Start backend and frontend:**
   ```bash
   npm run dev:all
   ```

2. **Test key functionality:**
   - Log in as a user
   - View Canvas data (assignments, courses, files)
   - Mark assignment as complete (tests upsert)
   - Check integration syncs work
   - Create a chat post

3. **Check logs for errors:**
   Look for database errors or JSONB field access issues

### Step 6: Clean Up Old Tables (After 1 Week)

**ONLY after confirming everything works for 1 week!**

```sql
-- List all old user tables
SELECT tablename
FROM pg_tables
WHERE table_schema = 'public'
  AND tablename LIKE 'user_%_data';

-- Drop each one (example)
DROP TABLE user_john_at_colorado_edu_data;
DROP TABLE user_jane_at_colorado_edu_data;
-- ... repeat for all users

-- Or automate with a function:
CREATE OR REPLACE FUNCTION drop_all_user_tables()
RETURNS void AS $$
DECLARE
  table_record RECORD;
BEGIN
  FOR table_record IN
    SELECT tablename
    FROM pg_tables
    WHERE table_schema = 'public'
      AND tablename LIKE 'user_%_data'
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', table_record.tablename);
    RAISE NOTICE 'Dropped table: %', table_record.tablename;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Run it:
SELECT drop_all_user_tables();
```

---

## Rollback Plan

### If Issues Arise Before Dropping Old Tables

1. **Revert RPC functions to use old tables:**
   - Find the old version of `get_user_entities()` and `upsert_user_entity()`
   - Re-create them pointing to per-user tables
   - Or restore from backup

2. **Application keeps working:**
   - Old tables still exist
   - Data is intact
   - Fix issues and retry migration

### If Issues Arise After Dropping Old Tables

1. **Restore from backup:**
   ```bash
   psql -h your-db-host -U postgres -d your-db-name < backup-20260109.sql
   ```

2. **Re-apply only essential migrations**

3. **Fix issues before retrying consolidation**

---

## What Application Code Needs to Change

### No Changes Required (Backward Compatible)

The migration is **backward compatible** - existing application code continues to work:

- `get_user_entities()` RPC still has same signature
- `upsert_user_entity()` RPC still has same signature
- Frontend code using these RPCs works unchanged

### Optional Improvements

You can optionally simplify code that had fallbacks for field name variations:

**Before (checking multiple field names):**
```typescript
const dueDate = assignment.data?.dueAt ||
                assignment.data?.due_at ||
                assignment.data?.dueDate ||
                null;
```

**After (with standardized names):**
```typescript
const dueDate = assignment.data?.dueAt || null;
```

See `frontend/supabase/FIELD_NAMING_STANDARDS.md` for complete standards.

---

## Troubleshooting

### Migration Function Fails

**Error:** `relation "user_john_at_colorado_edu_data" does not exist`

**Solution:** User has no old table (likely new user added after migration). This is expected - skip that user.

### Data Counts Don't Match

**Check for NULL course_id:**
```sql
-- Old tables may have had course_id as NULL
-- New table converts NULL to empty string ''
SELECT count(*) FROM extraction_data
WHERE user_email = 'john@colorado.edu'
  AND (course_id IS NULL OR course_id = '');
```

**Fix:** Update migration function to handle NULL consistently.

### Application Can't Find Data

**Check RLS policies:**
```sql
-- Verify RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename = 'extraction_data';

-- Check policies exist
SELECT * FROM pg_policies
WHERE tablename = 'extraction_data';
```

**Fix:** Ensure application sets `current_setting('app.current_user_email')` correctly.

### Performance is Slower

**Add missing indexes:**
```sql
-- Check which indexes exist
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'extraction_data';

-- Add custom indexes if needed
CREATE INDEX idx_extraction_data_custom
ON extraction_data(user_email, entity_type, (data->>'someField'));
```

---

## Expected Benefits

After successful migration:

✅ **Simplicity**
- Single table instead of N per-user tables
- Easier to understand schema
- Cleaner migration history

✅ **Performance**
- Better query planning (one table vs thousands)
- Proper indexes on commonly queried columns
- Faster aggregations across users

✅ **Maintainability**
- One RLS policy instead of per-table policies
- Standard backup/restore procedures
- Easier to add new columns

✅ **Scalability**
- No unbounded table growth
- Database doesn't slow down with more users
- Cross-user analytics possible

✅ **Data Integrity**
- All existing data preserved
- Foreign key to users table enforced
- UNIQUE constraints on (user_email, entity_type, entity_id, course_id)

---

## Additional Resources

- **Field Naming Standards:** `frontend/supabase/FIELD_NAMING_STANDARDS.md`
- **CLAUDE.md Schema Section:** `.claude/CLAUDE.md` (search for "Supabase Schema Architecture")
- **Migration Plan:** `/Users/karthikreddy/.claude/plans/precious-drifting-ladybug.md`

---

## Questions or Issues?

If you encounter issues:
1. Check the troubleshooting section above
2. Verify backup exists before proceeding
3. Test on a development database first
4. Review migration logs for warnings/errors

The old per-user tables remain for 1 week as a safety net. Don't drop them until you're confident everything works!
