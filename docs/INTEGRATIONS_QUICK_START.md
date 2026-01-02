# Integrations Quick Start Checklist

## ✅ Step-by-Step Setup

### 1. Database Setup
- [ ] Run Supabase migration: `cd frontend && supabase db push`
- [ ] Verify tables created: `integrations` and `integration_item_mappings`

### 2. Google Sheets Setup
- [ ] Create Google Cloud project
- [ ] Enable Google Sheets API
- [ ] Create OAuth 2.0 credentials (Web application)
- [ ] Add redirect URI: `http://localhost:3000/api/integrations/google/callback`
- [ ] Copy Client ID and Client Secret

### 3. Notion Setup
- [ ] Create Notion integration at https://www.notion.so/my-integrations
- [ ] Set type to "Public"
- [ ] Add redirect URI: `http://localhost:3000/api/integrations/notion/callback`
- [ ] Copy OAuth Client ID and Secret
- [ ] Get a Notion page ID (32-char ID from page URL)

### 4. Environment Variables
Add to your root `.env` file (in the project root):

```env
# Google
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/integrations/google/callback

# Notion
NOTION_CLIENT_ID=your-client-id
NOTION_CLIENT_SECRET=your-secret
NOTION_REDIRECT_URI=http://localhost:3000/api/integrations/notion/callback
NOTION_PARENT_PAGE_ID=your-32-char-page-id

# Encryption (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
INTEGRATIONS_TOKEN_ENC_KEY=your-64-char-hex-key

# Supabase (if not already set)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
```

### 5. Install Dependencies
```bash
cd backend
npm install googleapis @notionhq/client
```

### 6. Restart Server
- [ ] Restart backend server to load new routes and env vars
- [ ] Verify server logs show integrations module loaded

### 7. Test
- [ ] Navigate to Calendar page
- [ ] Click "Export" > "Google Sheets"
- [ ] Complete OAuth flow
- [ ] Verify spreadsheet created
- [ ] Repeat for Notion

### 8. Daily Sync (Optional)
- [ ] Set up GitHub Actions workflow, OR
- [ ] Set up Supabase scheduled function, OR
- [ ] Set up server cron job

## 🔗 Quick Links

- **Google Cloud Console**: https://console.cloud.google.com/
- **Notion Integrations**: https://www.notion.so/my-integrations
- **Full Setup Guide**: See `docs/INTEGRATIONS_SETUP.md`

## ⚠️ Common Issues

**"Cannot POST /api/integrations/..."**
→ Restart backend server after installing packages

**"Missing env var"**
→ Check all environment variables are set in your root `.env` file

**OAuth redirect errors**
→ Verify redirect URIs match exactly in OAuth apps

**Sync not working**
→ Check `integrations` table `last_sync_error` column

