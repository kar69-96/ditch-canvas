# Week-Based Content Organization

## Overview

The upload script now automatically organizes pages and files by week, creating modules like "Week 1", "Week 2", etc. with proper subitems (pages and files) under each week.

## How It Works

### 1. Week Extraction

The system extracts week information from multiple sources:
- **Page titles**: "Week 1: Aug 24-30"
- **Page slugs**: "week-1-aug-24-30-introduction"
- **Folder names**: "pages/week-1-aug-24-30-introduction-journal-entries"
- **Module names**: "Week 1 Introduction"

### 2. Data Organization

During upload, the script:
1. **Groups pages by week** - Extracts week from page title/slug and groups them
2. **Groups files by week** - Extracts week from downloads folder structure
3. **Creates week-based modules** - Combines pages and files from the same week into a single module

### 3. Module Structure

Each week module contains:
- **Module name**: "Week 1", "Week 2", etc.
- **Items array** with:
  - Pages from that week (as "Page" type items)
  - Files from that week's folder (as "File" type items)
- **Proper sorting**: Modules sorted by week number (1, 2, 3...)

### 4. Display

The frontend displays:
- Week modules in order (Week 1, Week 2, etc.)
- All pages and files as subitems under each week
- Proper accordion/collapsible structure

## Example Structure

For Accounting course:
```
Week 1
  ├─ Page: Week 1: Aug 24-30 Introduction
  ├─ File: Class_1_Slides.pptx
  ├─ File: In-class_01_Mechanics.docx
  └─ File: Class_02_Mechanics.pptx

Week 2
  ├─ Page: Week 2: Aug 31 - Sep 6
  ├─ File: Class_03_Inc_Stmt.pptx
  └─ File: In-class_03_Income_Stmt.docx
```

## Re-uploading Data

To apply the new week-based organization:

```bash
# Re-upload data (this will create week-based modules)
node supabase/upload-extraction-data.js kare6625@colorado.edu sample_data
```

The script will:
1. Upload all existing data (courses, assignments, etc.)
2. Upload pages and track them by week
3. Upload files and track them by week from folder structure
4. Create week-based modules combining pages and files
5. Sort modules by week number

## Notes

- **Existing modules** from `moduleFiles` are preserved
- **Week-based modules** are created in addition to existing modules
- **Pages without week info** go into "Other Content" module
- **Files without week info** go into "Other Content" module
- Modules are sorted: Week 1, Week 2, ..., Other Content


