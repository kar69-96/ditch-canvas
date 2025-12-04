# Fix: Week Modules Not Showing Sub-items

## Problem
Week modules (Week 1, Week 2, etc.) are displaying but showing no sub-items (pages and files).

## Solution
The upload script has been updated to properly create week-based modules with items. You need to **re-upload the data** to apply the changes.

## Steps to Fix

1. **Re-upload the extraction data:**
   ```bash
   node supabase/upload-extraction-data.js kare6625@colorado.edu sample_data
   ```

2. **What the script will do:**
   - Extract week information from page titles (e.g., "Week 1: Aug 24-30")
   - Extract week information from page slugs (e.g., "week-1-aug-24-30")
   - Extract week information from file folder structure (e.g., "pages/week-1-aug-24-30/")
   - Group pages and files by week
   - Create week-based modules with proper items array
   - Store modules with numeric IDs for items

3. **Expected output:**
   ```
   📦 Creating week-based modules from pages and files...
      📦 Creating module "Week 1" with 1 pages and 5 files
      ✅ Created module: Week 1 (6 items: 1 pages, 5 files)
         Sample items: Week 1: Aug 24-30 (Page), Class_1_Slides.pptx (File), ...
   ```

4. **Verify in the app:**
   - Open the Accounting course
   - You should see "Week 1", "Week 2", etc. modules
   - Each week module should expand to show pages and files as sub-items

## What Was Fixed

1. **Item ID Format**: Items now use proper numeric IDs instead of string IDs like "page-123"
2. **Item Structure**: Items include both `title` and `name` fields for compatibility
3. **Week Extraction**: Enhanced to extract weeks from pageSlug, title, and folder names
4. **Debug Logging**: Added logging to track module creation and item counts

## Troubleshooting

If items still don't show after re-upload:

1. **Check the console logs** during upload to see:
   - How many pages/files are being added to each week
   - How many items are in each module
   - Sample item names

2. **Check the database** to verify modules have items:
   ```sql
   SELECT entity_id, data->'items' as items 
   FROM user_kare6625_at_colorado_edu_data 
   WHERE entity_type = 'module' 
   AND data->>'name' LIKE 'Week%';
   ```

3. **Check the frontend** to see if items are being parsed:
   - Open browser console
   - Check if `mockCanvasData.modules` has items arrays
   - Verify items have `id`, `title`, and `type` fields


