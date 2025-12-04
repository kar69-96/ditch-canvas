# Quick Fix: Apply Migration to Fix 404 Error

## The Problem
The error `Failed to load resource: the server responded with a status of 404 (get_user_entities)` means the database functions haven't been created yet.

## Solution: Apply the Migration

### Option 1: Via Supabase Dashboard (Easiest)

1. **Open Supabase Dashboard**
   - Go to: https://supabase.com/dashboard
   - Select your project

2. **Open SQL Editor**
   - Click "SQL Editor" in the left sidebar
   - Click "New query"

3. **Copy and Run Migration**
   - Open the file: `supabase/migrations/20251202000000_flexible_schema_less_storage.sql`
   - Copy ALL the SQL content (the entire file)
   - Paste into the SQL Editor
   - Click "Run" (or press Cmd/Ctrl + Enter)

4. **Verify Success**
   - You should see "Success. No rows returned" or similar
   - Check that functions were created by running:
     ```sql
     SELECT routine_name 
     FROM information_schema.routines 
     WHERE routine_schema = 'public' 
     AND routine_name LIKE '%user%';
     ```
   - You should see functions like: `get_user_entities`, `upsert_user_entity`, `create_user_data_table`

### Option 2: Via Supabase CLI

```bash
# If you have Supabase CLI linked
supabase db push

# Or apply specific migration
supabase migration up
```

## After Migration

Once the migration is applied, you'll need to upload your data:

```bash
node supabase/upload-extraction-data.js kare6625@colorado.edu sample_data
```

## Verify It's Working

After applying the migration and uploading data, refresh your browser. The 404 errors should be gone and you should see your course data.


