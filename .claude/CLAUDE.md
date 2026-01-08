# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

YAY_FINAL is a full-stack Canvas LMS data extraction and management system consisting of:
- **Backend**: Node.js/Express server that extracts Canvas data using Browserbase cloud browsers and Playwright
- **Frontend**: React 18 + TypeScript dashboard with Vite, Tailwind CSS, and shadcn/ui components

The system extracts assignments, courses, files, and modules from Canvas LMS and provides a modern web interface for viewing and managing the data.

## Key Architecture Patterns

### Backend Architecture

The backend is structured around three main concerns:

1. **Cookie Authentication Flow** (`src/core/extract-cookies.js`, `extract-cookies-streaming.js`)
   - Uses Browserbase cloud browsers to authenticate with Canvas
   - Stores encrypted cookies for subsequent API requests
   - Two modes: standard extraction and streaming with real-time viewer
   - Streaming server runs on separate port (default 3002) with Socket.IO for real-time updates

2. **Canvas Data Extraction** (`src/crawler/canvas-crawler.js`)
   - Multi-layered content discovery system
   - Crawlee-based scraper with parallel processing
   - Extractors in `src/crawler/extractors/` for different Canvas content types
   - Downloads files to local storage for offline access

3. **API Server** (`server.js`)
   - Express server with CORS configuration
   - Routes in `src/routes/` and `src/core/`
   - HTTP proxy setup for streaming authentication server
   - WebSocket support for Socket.IO connections
   - Serves built frontend from `client/dist` in production

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

### Canvas Data Extraction

```bash
# Extract Canvas authentication cookies
npm run auth:extract-cookies

# Extract with streaming viewer (real-time browser view)
npm run auth:extract-cookies:streaming:local

# Local authentication mode
npm run auth:extract-cookies:local

# Run Canvas data extraction
npm run crawl:canvas

# Map Canvas structure only (no downloads)
npm run crawl:map

# Full extraction with file downloads
npm run crawl:extract
```

### AWS Operations

```bash
# Check AWS configuration
npm run aws:check

# Run extraction on AWS EC2
npm run aws:extract

# Deploy streaming authentication to AWS
npm run aws:deploy-streaming

# Setup streaming infrastructure
npm run aws:setup-streaming

# Update Canvas data via AWS
npm run aws:update
```

### Supabase Operations

```bash
cd frontend

# Push database migrations
npm run supabase:push
npm run supabase:migrate  # Alternative

# Upload extraction data to Supabase
npm run supabase:upload-data

# Check Supabase connection status
npm run supabase:status

# Link to Supabase project
npm run supabase:link
```

## Web Verification with Playwright MCP

This project has Playwright MCP installed for browser-based verification. Use it to:

- Test the frontend UI in a real browser
- Verify authentication flows work correctly
- Check responsive design across viewports
- Validate deployed applications

Example usage:
```
use playwright mcp to navigate to http://localhost:5173 and verify the login page loads
use playwright mcp to test the calendar page displays assignments correctly
```

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

### Working with Canvas API

1. Authentication cookies are stored encrypted in `data/auth/` (or `OUTPUT_DIR`)
2. Use `extract-cookies.js` or `extract-cookies-streaming.js` to refresh cookies
3. Canvas crawler uses these cookies for authenticated API requests
4. Extractors in `src/crawler/extractors/` handle specific Canvas content types

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

- Streaming authentication requires separate server infrastructure (not available in Vercel serverless)
- Use Browserbase API token for cloud browser automation
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

### Canvas Cookie Extraction Failing

1. Check Browserbase API token is valid
2. Verify `CANVAS_URL` matches your institution
3. Try streaming mode for debugging: `npm run auth:extract-cookies:streaming:local`
4. Check browser console for error messages in streaming viewer

### Build Failures

1. Frontend: Ensure all environment variables have `VITE_` prefix
2. Backend: Check Node.js version compatibility (requires Node 18+)
3. Clear `node_modules` and reinstall: `rm -rf node_modules package-lock.json && npm install`
4. Check for TypeScript errors: `cd frontend && npm run lint`
