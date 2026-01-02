# Integrations Setup Guide

This guide covers everything you need to set up Google Sheets and Notion integrations for your users.

## Prerequisites

- Supabase project with database access
- Backend server running
- Frontend application running

## 1. Database Migration

First, apply the Supabase migration to create the necessary tables:

```bash
cd frontend
supabase db push
```

Or manually run the migration file:
- `frontend/supabase/migrations/20251225000000_integrations_v3_single_target.sql`

This creates:
- `integrations` table (stores OAuth tokens and sync status)
- `integration_item_mappings` table (ensures idempotent syncs)

## 2. Google Sheets OAuth Setup

### Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable the **Google Sheets API**:
   - Navigate to "APIs & Services" > "Library"
   - Search for "Google Sheets API"
   - Click "Enable"

### Step 2: Create OAuth 2.0 Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth client ID"
3. If prompted, configure the OAuth consent screen:
   - User Type: **External** (for production, use Internal if you have Google Workspace)
   - App name: Your app name
   - User support email: Your email
   - Developer contact: Your email
   - Scopes: Add `https://www.googleapis.com/auth/spreadsheets`
   - Test users: Add test emails (for development)

4. Create OAuth client:
   - Application type: **Web application**
   - Name: "Canvas Integrations"
   - Authorized redirect URIs:
     - Development: `http://localhost:3000/api/integrations/google/callback`
     - Production: `https://yourdomain.com/api/integrations/google/callback`

5. Copy the **Client ID** and **Client Secret**

### Step 3: Add to Environment Variables

Add to your root `.env` file (in the project root):

```env
GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret-here
GOOGLE_REDIRECT_URI=http://localhost:3000/api/integrations/google/callback
```

For production, update `GOOGLE_REDIRECT_URI` to your production URL.

## 3. Notion OAuth Setup

### Step 1: Create Notion Integration

1. Go to [Notion Integrations](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Fill in:
   - Name: "Canvas Assignments Sync"
   - Associated workspace: Select your workspace
   - Type: **Public** (allows OAuth)
   - Capabilities: Enable "Read content" and "Update content"
4. Click "Submit"
5. Copy the **OAuth client ID** and **OAuth client secret**

### Step 2: Set Up OAuth Redirect

1. In your integration settings, add redirect URI:
   - Development: `http://localhost:3000/api/integrations/notion/callback`
   - Production: `https://yourdomain.com/api/integrations/notion/callback`

### Step 3: Get Parent Page ID

You need a Notion page where databases will be created:

1. Open any Notion page in your workspace
2. Click "..." menu > "Copy link"
3. Extract the page ID from the URL:
   - URL format: `https://www.notion.so/PageName-{32-char-id}`
   - The page ID is the 32-character string (with dashes)

### Step 4: Add to Environment Variables

Add to your root `.env` file (in the project root):

```env
NOTION_CLIENT_ID=your-oauth-client-id-here
NOTION_CLIENT_SECRET=your-oauth-client-secret-here
NOTION_REDIRECT_URI=http://localhost:3000/api/integrations/notion/callback
NOTION_PARENT_PAGE_ID=your-32-char-page-id-here
```

For production, update `NOTION_REDIRECT_URI` to your production URL.

## 4. Token Encryption Key

Generate a secure 32-byte key for encrypting OAuth tokens:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add to `backend/.env`:

```env
INTEGRATIONS_TOKEN_ENC_KEY=your-64-character-hex-string-here
```

**Important**: Keep this key secure and never commit it to version control. Use different keys for development and production.

## 5. Supabase Configuration

Ensure these are set in `backend/.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key-here
```

The service role key is required because integrations tables use RLS that denies client access (for security).

## 6. Daily Sync Setup

The system includes a daily sync job. Choose one option:

### Option A: GitHub Actions (Recommended)

A workflow file is already created at `.github/workflows/integration-sync.yml`.

1. Add a secret to your GitHub repository:
   - Go to Settings > Secrets and variables > Actions
   - Add secret: `INTEGRATIONS_CRON_SECRET` (any random string)
   - Add secret: `BACKEND_URL` (your backend URL)

2. The workflow runs daily at 2 AM UTC

3. Update the workflow file if needed to match your deployment

### Option B: Supabase Scheduled Function

Create a Supabase Edge Function that calls your sync endpoint:

```sql
-- Create a pg_cron job (if you have pg_cron extension)
SELECT cron.schedule(
  'daily-integration-sync',
  '0 2 * * *', -- 2 AM daily
  $$
  SELECT net.http_post(
    url := 'https://your-backend.com/api/integrations/run-daily-sync',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SECRET"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
```

### Option C: Manual Cron Job

On your server, add to crontab:

```bash
0 2 * * * curl -X POST https://your-backend.com/api/integrations/run-daily-sync \
  -H "Authorization: Bearer YOUR_SECRET" \
  -H "Content-Type: application/json"
```

## 7. Complete Environment Variables Checklist

Add all of these to your root `.env` file:

```env
# Google OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/integrations/google/callback

# Notion OAuth
NOTION_CLIENT_ID=...
NOTION_CLIENT_SECRET=...
NOTION_REDIRECT_URI=http://localhost:3000/api/integrations/notion/callback
NOTION_PARENT_PAGE_ID=...

# Token Encryption
INTEGRATIONS_TOKEN_ENC_KEY=...

# Supabase (if not already set)
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...

# Optional: For daily sync endpoint protection
INTEGRATIONS_CRON_SECRET=...
```

## 8. Testing the Setup

1. **Restart your backend server** to load new environment variables

2. **Test Google Sheets integration**:
   - Navigate to Calendar page
   - Click "Export" > "Google Sheets"
   - Complete OAuth flow
   - Check that a new spreadsheet is created

3. **Test Notion integration**:
   - Click "Export" > "Notion"
   - Complete OAuth flow
   - Check that a new database is created in your Notion page

4. **Verify sync**:
   - Wait for daily sync or manually trigger:
     ```bash
     curl -X POST http://localhost:3000/api/integrations/run-daily-sync \
       -H "Authorization: Bearer YOUR_CRON_SECRET" \
       -H "Content-Type: application/json"
     ```

## 9. Production Deployment

### Before going to production:

1. **Update redirect URIs** in both Google and Notion:
   - Change from `localhost:3000` to your production domain
   - Update environment variables

2. **Use production OAuth credentials**:
   - Create separate OAuth apps for production
   - Never use development credentials in production

3. **Secure your encryption key**:
   - Use a different key for production
   - Store in secure secret management (AWS Secrets Manager, etc.)

4. **Set up monitoring**:
   - Monitor sync job failures
   - Set up alerts for `last_sync_error` in database
   - Log OAuth errors

5. **Rate limiting**:
   - Google Sheets API: 100 requests per 100 seconds per user
   - Notion API: 3 requests per second
   - The sync orchestrator includes basic rate limiting

## 10. Troubleshooting

### "Missing env var" errors
- Check that all environment variables are set in your root `.env` file
- Restart the backend server after adding variables

### "Cannot POST /api/integrations/..." errors
- Ensure backend server is running
- Verify integrations module loaded (check server logs)
- Make sure npm packages are installed: `npm install googleapis @notionhq/client`

### OAuth redirect errors
- Verify redirect URIs match exactly in OAuth apps and environment variables
- Check that redirect URI is added to authorized URIs in Google/Notion

### Sync not working
- Check `last_sync_error` in `integrations` table
- Verify tokens haven't expired (check `token_expires_at`)
- Check sync job logs
- Verify Supabase connection is working

### Token refresh issues
- Google refresh tokens are only issued on first consent with `prompt=consent`
- If refresh fails, integration status will be set to `needs_reauth`
- User will need to reconnect

## 11. Security Best Practices

1. **Never expose tokens to frontend** - All token operations use service role key
2. **Encrypt tokens at rest** - Uses AES-256-GCM encryption
3. **Use HTTPS in production** - OAuth requires secure redirects
4. **Rotate encryption keys periodically** - Plan for key rotation
5. **Monitor for suspicious activity** - Watch for unusual sync patterns
6. **Limit OAuth scopes** - Only request necessary permissions

## Support

For issues or questions:
- Check server logs for detailed error messages
- Review `integrations` table for sync status
- Check `integration_item_mappings` for sync history

