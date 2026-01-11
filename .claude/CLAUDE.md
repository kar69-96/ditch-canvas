# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

YAY_FINAL is a full-stack Canvas LMS data management and daily sync platform consisting of:
- **Backend**: Node.js/Express API server for Canvas data updates, integrations, and user management
- **Frontend**: React 18 + TypeScript dashboard with Vite, Tailwind CSS, and shadcn/ui components

The system provides a modern web interface for viewing and managing Canvas data, with daily updates and integrations to Google Sheets and Notion.

**Note**: Initial Canvas data extraction is handled by the separate `canvas-extraction` repository. This repository focuses on daily operations, updates, and user-facing features.

## Preferences
- Keep the repository lean. Simplify code and find efficient ways to execute
- Organize all files in an intuitive sense. Reduce bloat where possible
- For one-time use scripts (e.g., Supabase migration scripts), create them, execute, then delete
- Use existing CLIs where possible (supabase, vercel, aws) and download others if needed
- Do not create summary markdown files after long tasks unless specifically requested. Use bullet point summaries in chat instead
- Test the repository on ditchcanvas.com, not on localhost

### AWS EC2 Management
- **Always use AWS CLI** to search for instances comprehensively before assuming instance IDs
- Use `aws ec2 describe-instances --query '...' --output table` to list all instances
- **Hibernate instances after use** to reduce costs (don't leave running unnecessarily)
- Current streaming server instance: `i-020212a83e2089bf9` (verify with AWS CLI before use)
- SSH key location: `Canvas-Wrapper.pem` in project root
- Region: `us-east-1`

**Streaming Server Setup:**
- Cloudflare Tunnel provides HTTPS (required for production)
- PM2 manages the Node.js streaming server process
- **After EC2 restart**: The Cloudflare tunnel URL changes! Update Vercel env var:
  ```bash
  # SSH in and get new tunnel URL
  ssh -i Canvas-Wrapper.pem ec2-user@<IP> "grep trycloudflare /var/log/cloudflared.log | tail -1"
  # Update Vercel
  vercel env rm STREAMING_SERVER_URL production -y
  echo -n "https://<new-url>.trycloudflare.com" | vercel env add STREAMING_SERVER_URL production
  vercel --prod --yes
  ```

**AWS Commands Reference:**
```bash
# List all instances with status
aws ec2 describe-instances --region us-east-1 --query 'Reservations[*].Instances[*].{InstanceId:InstanceId,State:State.Name,PublicIP:PublicIpAddress,Name:Tags[?Key==`Name`].Value|[0]}' --output table

# Start instance
aws ec2 start-instances --instance-ids <instance-id>

# Hibernate instance (preferred over stop for faster resume)
aws ec2 stop-instances --instance-ids <instance-id> --hibernate

# Get instance public IP after starting
aws ec2 describe-instances --instance-ids <instance-id> --query 'Reservations[0].Instances[0].PublicIpAddress' --output text
```


## Key Architecture Patterns

### Backend Architecture

The backend is structured around three main concerns:

1. **Daily Update System** (`scripts/utils/update.js`)
   - Incremental Canvas data updates
   - Runs daily to sync new assignments, files, and course changes
   - Updates existing records and adds new content
   - Lightweight compared to full extraction

2. **API Server** (`server.js`)
   - Express server with CORS configuration
   - Routes in `src/routes/` and `src/core/`
   - HTTP proxy setup for streaming authentication server (used during onboarding)
   - WebSocket support for Socket.IO connections
   - Serves built frontend from `client/dist` in production

3. **Integration Services** (`src/services/`)
   - Google Sheets sync (export assignments to spreadsheets)
   - Notion sync (create assignment databases)
   - Sync orchestrator for managing multiple integrations
   - OAuth token management and refresh

### Frontend Architecture

1. **Authentication & Data Flow**
   - Supabase for authentication and data storage
   - TanStack Query for server state management
   - Local storage for user preferences (themes, fonts)
   - API communication through services in `frontend/src/services/`

2. **Component Structure**
   - Pages in `frontend/src/pages/` (routing via react-router-dom)
   - Reusable components in `frontend/src/components/`
   - shadcn/ui components for consistent design system
   - Custom hooks in `frontend/src/hooks/` for business logic

3. **Key Pages**
   - `Login.tsx`: Canvas authentication via streaming viewer
   - `Calendar.tsx`: Assignment calendar with drag-and-drop
   - `ClassDetail.tsx`: Course details with assignments and modules
   - `Dashboard.tsx`: Overview with upcoming assignments
   - Onboarding flow: `OnboardingInfo.tsx`, `OnboardingInvite.tsx`, `OnboardingSync.tsx`

### Critical Integration Points

1. **Streaming Authentication**
   - Backend proxies `/socket.io` and `/api/streaming-auth` to streaming server (port 3002)
   - Frontend connects to these endpoints for real-time Canvas login viewing
   - WebSocket upgrades handled in `server.js` upgrade listener
   - Cookie extraction happens in separate Node process (`extract-cookies-streaming.js`)

2. **Environment Configuration**
   - Backend: Root `.env` file (see `.env.example`)
   - Frontend: `frontend/.env` file with Vite prefix (`VITE_*`)
   - Production: Custom domain prioritized over Vercel URL in `frontend/src/lib/auth.ts`

3. **Deployment Architecture**
   - Vercel serverless deployment via `vercel.json`
   - Build: Frontend builds to `frontend/dist`, backend serves static files
   - API routes: Handled by serverless functions in `api/` directory
   - Note: Streaming auth runs as separate process, not available in serverless

## Development Commands

### Running the Application

```bash
# Install all dependencies (root + frontend)
npm install

# Development - Run backend only
npm run dev
npm run dev:server  # Alternative

# Development - Run both backend and frontend concurrently
npm run dev:all

# Production build and start
cd frontend && npm run build
npm start
```

### Frontend Development

```bash
cd frontend

# Start Vite dev server (port 5173)
npm run dev

# Build for production
npm run build

# Run linter
npm run lint

# Run tests
npm run test
npm run test:watch
npm run test:ui
npm run test:coverage
```

### Backend Testing

```bash
# Run all tests
npm test

# Run in watch mode
npm run test:watch

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration
```

### Daily Updates

```bash
# Run daily Canvas data update (incremental sync)
npm run update

# Compare metrics before and after update
npm run compare:metrics

# Seed chat data (utility)
npm run seed:chat
```

### Supabase Operations

```bash
cd frontend

# Apply database migrations (authenticated via CLI)
npx supabase db push
# Or use the npm script:
npm run supabase:push

# If migrations have syntax errors with nested dollar quotes, temporarily move problematic ones:
mkdir -p supabase/migrations/.temp
mv supabase/migrations/<problematic-migration>.sql supabase/migrations/.temp/
npx supabase db push --yes
mv supabase/migrations/.temp/* supabase/migrations/
rmdir supabase/migrations/.temp

# List applied migrations (verify what's in the database)
npx supabase migration list

# Upload extraction data to Supabase
npm run supabase:upload-data

# Check Supabase connection status
npm run supabase:status

# Link to Supabase project
npm run supabase:link
```

## Web Verification

For browser-based testing and verification, use the Claude Chrome extension instead of Playwright MCP.

The Chrome extension provides:
- Real-time browser interaction and testing
- Visual verification of UI components
- Authentication flow testing
- Responsive design validation

This approach provides better integration and more reliable testing results.

## Supabase Schema Architecture (Updated Jan 2026)

### Unified Extraction Data Storage

All Canvas extraction data (courses, assignments, files, modules, pages, quizzes, etc.) is stored in a single **`extraction_data`** table:

**Schema:**
- `user_email` - User identifier (FK to users.email)
- `entity_type` - Type: 'course', 'assignment', 'file', 'module', 'page', 'quiz', 'announcement'
- `entity_id` - Canvas entity ID
- `course_id` - Course grouping (optional)
- `data` - JSONB column storing all entity data
- `metadata` - JSONB column for user preferences and extraction metadata
- `file_storage_path`, `file_size`, `file_mime_type` - For file entities
- `organized_path` - File organization path
- Comprehensive indexes on user_email, entity_type, course_id, and JSONB fields

**Benefits:**
- Single table instead of per-user tables (no unbounded growth)
- User isolation via `user_email` column with RLS policies
- Flexible JSONB `data` and `metadata` columns for rapid iteration
- Proper indexes for fast queries
- Easier to maintain and backup

### Standard Field Names

See `frontend/supabase/FIELD_NAMING_STANDARDS.md` for complete field naming conventions.

**Key Standards:**
- Use camelCase for all JSONB field names (e.g., `dueAt`, `pointsPossible`)
- Use ISO 8601 format for all dates (e.g., `"2026-01-09T16:30:00.000Z"`)
- Consistent field names across entity types reduce transformation logic

### Querying Extraction Data

**Get entities for a user:**
```javascript
const { data, error } = await supabase.rpc('get_user_entities', {
  user_email: 'user@colorado.edu',
  entity_type_filter: 'assignment',  // Optional: filter by type
  course_id_filter: '123456'         // Optional: filter by course
});
```

**Upsert entity data:**
```javascript
const { data, error } = await supabase.rpc('upsert_user_entity', {
  user_email: 'user@colorado.edu',
  entity_type: 'assignment',
  entity_id: '789',
  course_id: '123456',
  entity_data: { title: 'Assignment 1', dueAt: '2026-01-15T23:59:00.000Z', ... },
  entity_metadata: { userMarkedComplete: false, extractedAt: '2026-01-09T12:00:00.000Z' }
});
```

### Other Key Tables

- **users** - User accounts with email, name, school, cookies, invite code
- **sessions** - User sessions with expiration
- **chat_posts**, **chat_responses**, **chat_votes** - Anonymous discussion forum
- **integrations**, **integration_item_mappings** - Google Sheets/Notion syncing
- **pending_extractions**, **completed_extractions** - Extraction queue tracking
- **waitlist**, **invite_codes** - Onboarding flow

### Migration Notes

- Old per-user tables (`user_{email}_data`) are deprecated as of Jan 2026
- Data has been migrated to unified `extraction_data` table
- Old RPC functions still work but point to new table
- Chat tables have RLS disabled (app-level auth by design)

## Environment Variables

### Critical Backend Variables

- `PORT`: Server port (default: 3000)
- `HOST`: Bind address (127.0.0.1 for dev, 0.0.0.0 for production)
- `CANVAS_URL`: Canvas LMS instance URL
- `COOKIE_ENCRYPTION_KEY`: Secret for cookie encryption (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
- `CLIENT_ORIGIN`: Comma-separated allowed CORS origins (REQUIRED for production)
- `STREAMING_PORT`: Port for streaming auth server (default: 3002)

### Critical Frontend Variables

- `VITE_SUPABASE_URL`: Supabase project URL
- `VITE_SUPABASE_ANON_KEY`: Supabase anonymous key
- `VITE_API_URL`: Backend API URL (auto-detected in production)

## Common Patterns

### Adding a New Backend Route

1. Create route file in `src/routes/` or add to existing route in `src/core/`
2. Export router from the file
3. Import and mount in `server.js`: `app.use('/api/your-route', yourRoute)`

### Adding a New Frontend Page

1. Create page component in `frontend/src/pages/`
2. Add route in `frontend/src/App.tsx` using react-router-dom
3. Update navigation in sidebar component if needed
4. Use TanStack Query for data fetching via services

### Working with Daily Updates

1. Daily updates run via `scripts/utils/update.js`
2. Updates fetch new assignments, courses, and files incrementally
3. User cookies are managed during onboarding and stored in Supabase
4. For initial extraction, use the `canvas-extraction` repository

### Proxy Configuration

The main server proxies two endpoints to the streaming server:
- `/socket.io/*` → Socket.IO for real-time events
- `/api/streaming-auth/*` → Streaming authentication endpoints

Both HTTP and WebSocket connections are proxied. The streaming server must be running separately during development.

## Production Deployment

### Vercel Deployment

1. Frontend builds to `frontend/dist/`
2. Backend serves static files from this directory
3. API routes in `/api` handled by serverless functions
4. Configure environment variables in Vercel dashboard
5. Set `CLIENT_ORIGIN` to production frontend URL

### Important Production Notes

- Streaming authentication requires separate server infrastructure (used during onboarding, not available in Vercel serverless)
- Initial extraction is handled by `canvas-extraction` repository
- Daily updates run via `npm run update` (can be scheduled via cron or similar)
- Ensure `COOKIE_ENCRYPTION_KEY` is securely generated and stored
- Set `NODE_ENV=production` for production builds
- Custom domain configuration in `frontend/src/lib/auth.ts` prioritizes custom domains over Vercel URLs

## Testing Strategy

### Backend Tests

Located in `tests/`:
- Unit tests in `tests/unit/`
- Integration tests in `tests/integration/`
- Uses Mocha test framework
- Supertest for HTTP endpoint testing

### Frontend Tests

Located in `frontend/src/`:
- Vitest for unit and component tests
- Testing Library for component testing
- Test files should be co-located with components (`.test.tsx`)

## Data Storage

### Backend Data

- Authentication cookies: `data/auth/` or `$OUTPUT_DIR/auth/`
- Downloaded Canvas files: `storage/` directory
- Logs: Root directory (e.g., `streaming.log`)

### Frontend Data

- Supabase PostgreSQL database for persistent storage
- Local storage for user preferences (themes, fonts, UI state)
- Session storage for temporary auth state

## Troubleshooting

### Streaming Authentication Not Working

1. Ensure streaming server is running (separate process on port 3002)
2. Check WebSocket proxy configuration in `server.js`
3. Verify Socket.IO client connection in browser DevTools
4. Check `STREAMING_PORT` environment variable

### CORS Errors

1. Verify `CLIENT_ORIGIN` is set correctly in backend `.env`
2. Check CORS middleware configuration in `server.js`
3. Ensure frontend is making requests to correct backend URL

### Build Failures

1. Frontend: Ensure all environment variables have `VITE_` prefix
2. Backend: Check Node.js version compatibility (requires Node 18+)
3. Clear `node_modules` and reinstall: `rm -rf node_modules package-lock.json && npm install`
4. Check for TypeScript errors: `cd frontend && npm run lint`
