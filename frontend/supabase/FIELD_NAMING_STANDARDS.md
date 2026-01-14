# Extraction Data Field Naming Standards

This document defines the standard field names used in the `extraction_data` table's JSONB `data` and `metadata` columns.

## Purpose

The flexible JSONB storage allows rapid iteration and varying data structures. However, to maintain code clarity and reduce transformation complexity, we standardize field names where possible.

**Goal**: Use consistent camelCase naming for all fields to reduce the need for multiple fallback checks in application code.

---

## Standard Field Names by Entity Type

### Assignments

**data JSONB fields:**
- `id` (number) - Canvas assignment ID
- `title` (string) - Assignment title
- `dueAt` (ISO 8601 string | null) - Due date and time
- `assignedAt` (ISO 8601 string | null) - Assigned/published date
- `courseId` (number) - Canvas course ID
- `courseName` (string) - Full course name
- `courseCode` (string) - Course code (e.g., "CSCI 3308")
- `pointsPossible` (number | null) - Maximum points
- `submissionStatus` ("yes" | "no" | null) - Whether user submitted
- `workflowState` (string) - Canvas workflow state ("published", "unpublished", etc.)
- `url` (string) - Direct link to assignment on Canvas
- `description` (string | null) - HTML description/instructions
- `submissionTypes` (array of strings) - Allowed submission types

**metadata JSONB fields:**
- `userMarkedComplete` (boolean) - User manually marked as complete
- `userNotes` (string | null) - User's personal notes
- `userPriority` (number | null) - User-set priority (1-5)
- `extractedAt` (ISO 8601 string) - When this was extracted
- `extractionVersion` (string) - Version of extractor used

---

### Courses

**data JSONB fields:**
- `id` (number) - Canvas course ID
- `name` (string) - Full course name
- `code` (string) - Course code (e.g., "CSCI 3308")
- `instructor` (string | null) - Instructor name
- `color` (string | null) - Hex color code for course
- `enrollmentTermId` (number | null) - Canvas term ID
- `workflowState` (string) - Course state ("available", "completed", etc.)
- `startAt` (ISO 8601 string | null) - Course start date
- `endAt` (ISO 8601 string | null) - Course end date

**metadata JSONB fields:**
- `extractedAt` (ISO 8601 string) - When this was extracted
- `totalAssignments` (number | null) - Count of assignments in course
- `totalFiles` (number | null) - Count of files in course

---

### Files

**data JSONB fields:**
- `id` (number) - Canvas file ID
- `name` (string) - File name with extension
- `displayName` (string) - User-friendly display name
- `size` (number) - File size in bytes
- `mimeType` (string) - MIME type (e.g., "application/pdf")
- `modifiedAt` (ISO 8601 string) - Last modified date
- `url` (string) - Canvas download URL
- `courseId` (number) - Parent course ID
- `courseName` (string | null) - Parent course name
- `folderId` (number | null) - Canvas folder ID

**metadata JSONB fields:**
- `organizedPath` (string | null) - Organized folder path
- `downloaded` (boolean) - Whether file was downloaded
- `extractedAt` (ISO 8601 string) - When this was extracted

Note: Also stored in top-level columns: `file_storage_path`, `file_size`, `file_mime_type`, `organized_path`

---

### Modules

**data JSONB fields:**
- `id` (number) - Canvas module ID
- `name` (string) - Module name
- `position` (number) - Sort position in course
- `unlockAt` (ISO 8601 string | null) - When module unlocks
- `courseId` (number) - Parent course ID
- `courseName` (string | null) - Parent course name
- `items` (array of objects) - Module items (assignments, pages, files, etc.)

Each item in `items` array:
```json
{
  "id": number,
  "title": string,
  "type": "Assignment" | "Page" | "File" | "ExternalUrl" | "Discussion",
  "indent": number,
  "url": string
}
```

**metadata JSONB fields:**
- `extractedAt` (ISO 8601 string) - When this was extracted
- `itemCount` (number) - Number of items in module

---

### Pages

**data JSONB fields:**
- `id` (number | string) - Canvas page ID or URL
- `title` (string) - Page title
- `body` (string) - HTML body content
- `url` (string) - Page URL
- `courseId` (number) - Parent course ID
- `courseName` (string | null) - Parent course name
- `createdAt` (ISO 8601 string | null) - Creation date
- `updatedAt` (ISO 8601 string | null) - Last update date

**metadata JSONB fields:**
- `extractedAt` (ISO 8601 string) - When this was extracted

---

### Quizzes

Quizzes are stored as assignments with additional fields.

**data JSONB fields:**
- All assignment fields (see above) +
- `isQuiz` (boolean) - Always `true` for quizzes
- `timeLimit` (number | null) - Time limit in minutes
- `allowedAttempts` (number) - Number of attempts allowed (-1 = unlimited)
- `questionCount` (number | null) - Number of questions
- `pointsPossible` (number) - Total points
- `dueAt` (ISO 8601 string | null) - Due date
- `unlockAt` (ISO 8601 string | null) - When quiz becomes available
- `lockAt` (ISO 8601 string | null) - When quiz locks

**metadata JSONB fields:**
- Same as assignments

---

### Announcements

**data JSONB fields:**
- `id` (number) - Canvas announcement ID
- `title` (string) - Announcement title
- `message` (string) - HTML message body
- `postedAt` (ISO 8601 string) - When posted
- `author` (string | null) - Author name
- `courseId` (number) - Parent course ID
- `courseName` (string | null) - Parent course name
- `url` (string) - Canvas URL

**metadata JSONB fields:**
- `extractedAt` (ISO 8601 string) - When this was extracted

---

### Discussions

**data JSONB fields:**
- `id` (number) - Canvas discussion ID
- `title` (string) - Discussion title
- `message` (string | null) - HTML message/prompt
- `postedAt` (ISO 8601 string | null) - When posted
- `courseId` (number) - Parent course ID
- `courseName` (string | null) - Parent course name
- `url` (string) - Canvas URL
- `requireInitialPost` (boolean | null) - Must post before reading replies
- `replyCount` (number | null) - Number of replies

**metadata JSONB fields:**
- `extractedAt` (ISO 8601 string) - When this was extracted

---

## Common metadata Fields

All entity types should include:
- `extractedAt` (ISO 8601 string) - Timestamp of extraction
- `extractionVersion` (string | null) - Version identifier of extractor

User-specific metadata (optional):
- `userMarkedComplete` (boolean) - User marked as complete
- `userNotes` (string | null) - User's notes
- `userPriority` (number | null) - User priority (1-5 scale)
- `userHidden` (boolean) - User hid this item

---

## Date/Time Format Standard

**Always use ISO 8601 format for dates:**
- `YYYY-MM-DDTHH:mm:ss.sssZ`
- Example: `"2026-01-09T16:30:00.000Z"`

**Why?**
- Unambiguous
- Sortable as strings
- Native JavaScript `Date` constructor support
- PostgreSQL TIMESTAMPTZ compatibility

**Avoid:**
- Custom formats like "Posted Aug 20 12:58pm"
- Unix timestamps (hard to read)
- Local time without timezone

---

## Field Access in Application Code

When reading JSONB fields, always provide fallbacks for legacy naming:

```typescript
// Good: Check multiple possible field names
const dueDate = assignment.data?.dueAt ||
                assignment.data?.due_at ||
                assignment.data?.dueDate ||
                null;

// Better: Use helper function
import { getAssignmentDueDate } from '@/utils/extractionDataHelpers';
const dueDate = getAssignmentDueDate(assignment);
```

See `frontend/src/utils/extractionDataHelpers.ts` for standardized accessor functions.

---

## Migration from Old Field Names

When updating extractors or data:
1. **Add new standardized field** (e.g., `dueAt`)
2. **Keep old field temporarily** (e.g., `due_date`) for backward compatibility
3. **Update application code** to use new field with fallback
4. **After 1-2 extraction cycles**, remove old field from extractors

This ensures existing data remains accessible during transition.

---

## Validation & Testing

To validate field naming in extracted data:

```sql
-- Check for common field name variations
SELECT
  user_email,
  entity_type,
  jsonb_object_keys(data) as field_names
FROM extraction_data
WHERE entity_type = 'assignment'
LIMIT 100;

-- Look for snake_case fields that should be camelCase
SELECT
  user_email,
  entity_type,
  entity_id,
  jsonb_object_keys(data) as field_name
FROM extraction_data
WHERE jsonb_object_keys(data) LIKE '%\_%'  -- Contains underscore
  AND entity_type = 'assignment';
```

---

## Summary

- **Use camelCase** for all JSONB field names
- **Use ISO 8601** for all dates/times
- **Document entity-specific fields** when adding new extractors
- **Provide fallbacks** when reading for backward compatibility
- **Update extractors** to output standardized field names

This standard simplifies application code and improves maintainability of the flexible JSONB storage system.
