<!-- 9d44d1cf-065f-4ffb-93b9-a5f4a4bdc071 5c9f48b4-9e4a-4981-b137-aff70691c28a -->
# Canvas Authentication System with Supabase Storage

## Overview

Build a custom authentication system that authenticates users via Canvas, extracts cookies and username (IdentiKey), stores everything in Supabase Storage buckets, and automatically triggers AWS extraction/update scripts.

## Architecture

### Storage Structure (Supabase Storage Buckets)

- **Bucket name**: `user-data` (or configurable)
- **Folder structure per user**: `{identikey}/`
- `cookies/canvas-cookies.json` - Canvas authentication cookies
- `dataset/extraction-{timestamp}/` - AWS extraction results
- `canvas-sync/sync-metadata.json` - Canvas sync configuration
- `metadata/user-info.json` - User metadata (email, canvas_user_id, etc.)

### Database Tables (Minimal)

- `users` - Basic user info (id, email, identikey, canvas_user_id, created_at, updated_at)
- `sessions` - Authentication sessions (id, user_id, token, expires_at, created_at)
- `canvas_auth_logs` - Track authentication attempts (id, user_id, identikey, success, created_at)

## Implementation Plan

### 1. Supabase Setup

- **File**: `frontend/supabase/migrations/YYYYMMDD_create_auth_storage.sql`
- Create minimal `users` table with identikey field
- Create `sessions` table
- Create `canvas_auth_logs` table
- Set up RLS policies for secure access
- Create storage bucket `user-data` via migration script
- Set up bucket policies for user-specific folder access

### 2. Backend Authentication Service

- **File**: `backend/src/core/canvas-auth-service.js` (new)
- `authenticateWithCanvas()` - Opens browser window, waits for login, extracts cookies and identikey
- `extractIdentikey()` - Extracts Canvas IdentiKey from page
- `saveCookiesToSupabase()` - Saves cookies to Storage bucket
- `saveUserMetadata()` - Saves user metadata to Storage and database
- `matchUserByIdentikey()` - Matches user by IdentiKey during login

- **File**: `backend/src/routes/auth.js` (update)
- `POST /api/auth/canvas/authenticate` - Start Canvas authentication (onboarding)
- `POST /api/auth/canvas/login` - Login with Canvas authentication
- `GET /api/auth/canvas/status/:sessionToken` - Check authentication status
- `POST /api/auth/canvas/extract-cookies` - Extract cookies from browser session

### 3. Backend Integration with AWS Scripts

- **File**: `backend/src/core/aws-script-runner.js` (new)
- `runAwsExtraction(userId, identikey)` - Runs `npm run aws:extract` after onboarding
- `runUpdateScript(userId, identikey)` - Runs update script after login
- Handles script execution, error handling, and result storage

### 4. Frontend Onboarding Updates

- **File**: `frontend/src/pages/Onboarding.tsx` (update)
- Add "Sync with Canvas" button/step
- Open Canvas authentication window
- Show progress during cookie extraction
- Handle successful authentication and trigger AWS extraction
- Store user session after successful sync

- **File**: `frontend/src/components/onboarding/CanvasSync.tsx` (new)
- Component for Canvas sync step
- Handles opening auth window
- Shows authentication status
- Triggers backend authentication endpoint

### 5. Frontend Login Updates

- **File**: `frontend/src/pages/Login.tsx` (update)
- After email entry, open Canvas authentication window
- Extract identikey and match with stored user
- If match, extract cookies, log user in, trigger update script
- Show error if identikey doesn't match

- **File**: `frontend/src/services/api/auth.ts` (new/update)
- `authenticateWithCanvas()` - Call backend auth endpoint
- `loginWithCanvas(email)` - Login flow with Canvas
- `checkAuthStatus(sessionToken)` - Check authentication status

### 6. Supabase Storage Integration

- **File**: `backend/src/core/supabase-storage.js` (new)
- `uploadCookies(identikey, cookies)` - Upload cookies to bucket
- `uploadUserMetadata(identikey, metadata)` - Upload user metadata
- `getCookies(identikey)` - Retrieve cookies from bucket
- `createUserFolder(identikey)` - Create user folder structure
- `uploadExtractionData(identikey, extractionData)` - Upload extraction results

- **File**: `frontend/src/lib/supabase-storage.ts` (new)
- Client-side Supabase Storage helpers
- Upload/download functions for user data

### 7. Cookie Extraction Enhancement

- **File**: `backend/src/core/extract-cookies.js` (update)
- Add identikey extraction
- Integrate with Supabase Storage
- Return both cookies and user info

- **File**: `backend/src/routes/auth.js` (update existing extraction)
- Enhance `extractUserInfo()` to reliably extract IdentiKey
- Store identikey in database and Storage

### 8. Session Management

- **File**: `backend/src/core/session-manager.js` (new)
- `createSession(userId, identikey)` - Create authenticated session
- `validateSession(token)` - Validate session token
- `getUserFromSession(token)` - Get user from session
- Store sessions in Supabase database

### 9. Configuration Updates

- **File**: `backend/src/core/config.js` (update)
- Add Supabase Storage configuration
- Add Canvas URL configuration
- Add bucket name configuration

- **File**: `frontend/.env.example` (update)
- Add Supabase Storage bucket name
- Add backend API URL for auth endpoints

### 10. Supabase CLI Migration

- **File**: `frontend/supabase/migrations/YYYYMMDD_create_storage_bucket.sql`
- Create storage bucket via SQL (if supported) or provide CLI commands
- Set up bucket policies
- Create RLS policies for bucket access

## Key Files to Modify/Create

### Backend

- `backend/src/core/canvas-auth-service.js` (new)
- `backend/src/core/supabase-storage.js` (new)
- `backend/src/core/aws-script-runner.js` (new)
- `backend/src/core/session-manager.js` (new)
- `backend/src/routes/auth.js` (update)
- `backend/src/core/extract-cookies.js` (update)
- `backend/src/core/config.js` (update)

### Frontend

- `frontend/src/pages/Onboarding.tsx` (update)
- `frontend/src/pages/Login.tsx` (update)
- `frontend/src/components/onboarding/CanvasSync.tsx` (new)
- `frontend/src/services/api/auth.ts` (new/update)
- `frontend/src/lib/supabase-storage.ts` (new)
- `frontend/src/lib/supabase.ts` (update)

### Database

- `frontend/supabase/migrations/YYYYMMDD_create_auth_storage.sql` (new)
- `frontend/supabase/migrations/YYYYMMDD_create_storage_bucket.sql` (new)

## Security Considerations

- RLS policies on database tables (users can only access their own data)
- Storage bucket policies (users can only access their own folder)
- Secure cookie storage (encrypted in Storage)
- Session token validation
- IdentiKey matching for login verification

## Testing Checklist

- [ ] Onboarding: Canvas sync extracts cookies and identikey
- [ ] Onboarding: AWS extraction runs after successful sync
- [ ] Login: Canvas auth window opens after email entry
- [ ] Login: IdentiKey matching works correctly
- [ ] Login: Update script runs after successful login
- [ ] Storage: Cookies saved to correct bucket path
- [ ] Storage: User metadata saved correctly
- [ ] Database: User records created with identikey
- [ ] Database: Sessions created and validated
- [ ] Multi-user: Different users can authenticate independently

### To-dos

- [ ] Create Supabase migrations for users/sessions tables and storage bucket setup with RLS policies
- [ ] Create canvas-auth-service.js with authentication, cookie extraction, and identikey extraction functions
- [ ] Create supabase-storage.js for uploading/downloading user data to/from Storage buckets
- [ ] Create aws-script-runner.js to trigger npm run aws:extract and update scripts
- [ ] Update auth.js routes to add Canvas authentication endpoints for onboarding and login
- [ ] Create session-manager.js for secure session creation and validation
- [ ] Update Onboarding.tsx and create CanvasSync.tsx component for Canvas sync during onboarding
- [ ] Update Login.tsx to open Canvas auth window after email entry and match identikey
- [ ] Create/update auth.ts service to call backend Canvas authentication endpoints
- [ ] Create supabase-storage.ts client-side helpers for Storage bucket operations
- [ ] Update extract-cookies.js to extract identikey and integrate with Supabase Storage
- [ ] Update config files with Supabase Storage and Canvas authentication settings