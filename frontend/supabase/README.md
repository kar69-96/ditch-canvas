# Supabase Database Setup Guide

This directory contains SQL migrations and scripts for managing your Supabase database.

## Quick Start

### 1. Run Database Migrations

#### Migration 1: Users and Sessions
```bash
npm run supabase:show
```
Copy the SQL and run it in Supabase SQL Editor.

#### Migration 2: Extraction Data Tables
```bash
# View the migration
cat supabase/migrations/002_create_extraction_data_tables.sql
```
Copy and run in Supabase SQL Editor.

### 2. Upload Extraction Data

```bash
# Upload data for a specific user
npm run supabase:upload-data <user_email>

# Example:
npm run supabase:upload-data alex.johnson@university.edu
```

The script will:
- Read from `mock-data/extraction-data/`
- Upload courses, assignments, announcements, modules, and grades
- Link all data to the user's email

## File Structure

```
supabase/
├── migrations/
│   ├── 001_create_users_and_sessions.sql    # User and session tables
│   └── 002_create_extraction_data_tables.sql # Canvas data tables
├── upload-extraction-data.js                # Upload script
├── show-migration.js                         # View migration SQL
└── README.md                                 # This file
```

## Database Schema

### Users Table
- Stores user accounts with email-based authentication
- Links to extraction data via `user_email`

### Sessions Table
- Manages user sessions
- Auto-expires based on `expires_at`

### Courses Table
- Canvas course data
- Linked to user via `user_email`

### Assignments Table
- Assignment data from Canvas
- Linked to courses via `course_id`
- Linked to user via `user_email`

### Announcements Table
- Course announcements
- Linked to courses and users

### Modules Table
- Course module structure
- Stores items as JSONB

### Grades Table
- User grades and GPA
- One record per user

## Usage

### Viewing Migrations

```bash
# Show first migration
npm run supabase:show

# View second migration
cat supabase/migrations/002_create_extraction_data_tables.sql
```

### Uploading Data

```bash
# Upload extraction data
npm run supabase:upload-data alex.johnson@university.edu
```

### Verifying Data

After uploading, verify in Supabase:
1. Go to **Table Editor**
2. Check each table has data
3. Filter by `user_email` to see user-specific data

## Troubleshooting

### "Table already exists" error
- The migrations use `CREATE TABLE IF NOT EXISTS`
- Safe to run multiple times

### "No data found" after upload
- Check that `extraction-summary.json` exists
- Verify the user email matches
- Check console output for errors

### Data not showing in app
- Verify data is in Supabase tables
- Check browser console for errors
- Ensure user email matches exactly (case-insensitive)

## Next Steps

1. Run both migrations in Supabase SQL Editor
2. Upload extraction data: `npm run supabase:upload-data <email>`
3. Test the app - it should load data from Supabase
4. If Supabase fails, it falls back to file system
