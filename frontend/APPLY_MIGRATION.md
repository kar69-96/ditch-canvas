# Apply Flexible Storage Migration

## Quick Steps

### Option 1: Via Supabase Dashboard (Recommended)

1. **Open Supabase Dashboard**
   - Go to: https://supabase.com/dashboard
   - Select your project

2. **Open SQL Editor**
   - Click on "SQL Editor" in the left sidebar
   - Click "New query"

3. **Copy and Run Migration**
   - Open the file: `supabase/migrations/20251202000000_flexible_schema_less_storage.sql`
   - Copy ALL the SQL content
   - Paste into the SQL Editor
   - Click "Run" (or press Cmd/Ctrl + Enter)

4. **Verify Migration**
   - Go to "Table Editor"
   - You should see functions like `get_user_table_prefix`, `create_user_data_table`, `upsert_user_entity`, `get_user_entities`
   - The old `user_*` tables should be gone

### Option 2: Via Supabase CLI

```bash
# If you have Supabase CLI installed
supabase db push

# Or link to your project first
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

## After Migration

Once the migration is applied, you can upload data:

```bash
node supabase/upload-extraction-data.js kare6625@colorado.edu sample_data
```

## Troubleshooting

### Error: "function does not exist"
- Make sure you ran the ENTIRE migration file
- Check that all functions were created in the SQL Editor

### Error: "permission denied"
- Make sure you're using the service role key or have admin access
- Check RLS policies if needed

### Files not uploading
- Create the storage bucket `user-files` first (see FLEXIBLE_STORAGE_SETUP.md)
- Set up RLS policies for file access


