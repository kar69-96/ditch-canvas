# Interactive Integrations Setup Guide

Follow these steps in order. I'll help you through each one.

## Part 1: Google Sheets OAuth Setup

### Step 1: Sign in to Google Cloud Console
1. Go to: https://console.cloud.google.com/
2. Sign in with your Google account
3. If you don't have a project, create one:
   - Click the project dropdown at the top
   - Click "New Project"
   - Name it (e.g., "Canvas Integrations")
   - Click "Create"

### Step 2: Enable Google Sheets API
1. Once in your project, go to: https://console.cloud.google.com/apis/library
2. Search for "Google Sheets API"
3. Click on "Google Sheets API"
4. Click the blue "ENABLE" button
5. Wait for it to enable (you'll see a checkmark)

### Step 3: Configure OAuth Consent Screen
1. Go to: https://console.cloud.google.com/apis/credentials/consent
2. If prompted, select "External" (unless you have Google Workspace, then use "Internal")
3. Click "CREATE"
4. Fill in the form:
   - **App name**: Canvas Assignments Sync (or your app name)
   - **User support email**: Your email
   - **Developer contact information**: Your email
   - **Privacy policy URL**: 
     - Development: `http://localhost:5173/privacy`
     - Production: `https://yourdomain.com/privacy`
   - **Terms of service URL**:
     - Development: `http://localhost:5173/terms`
     - Production: `https://yourdomain.com/terms`
5. Click "SAVE AND CONTINUE"
6. On "Scopes" page:
   - Click "ADD OR REMOVE SCOPES"
   - Search for "spreadsheets"
   - Check "https://www.googleapis.com/auth/spreadsheets"
   - Click "UPDATE"
   - Click "SAVE AND CONTINUE"
7. On "Test users" page (for development):
   - Click "ADD USERS"
   - Add your email address
   - Click "ADD"
   - Click "SAVE AND CONTINUE"
8. Review and click "BACK TO DASHBOARD"

### Step 4: Create OAuth 2.0 Credentials
1. Go to: https://console.cloud.google.com/apis/credentials
2. Click "+ CREATE CREDENTIALS" at the top
3. Select "OAuth client ID"
4. If prompted about consent screen, click "CONFIGURE CONSENT SCREEN" and complete Step 3 above first
5. In the "Create OAuth client ID" form:
   - **Application type**: Select "Web application"
   - **Name**: Canvas Integrations
   - **Authorized redirect URIs**: Click "ADD URI" and add:
     - For development: `http://localhost:3000/api/integrations/google/callback`
     - For production (later): `https://yourdomain.com/api/integrations/google/callback`
6. Click "CREATE"
7. **IMPORTANT**: Copy the **Client ID** and **Client Secret** immediately (you won't see the secret again!)
   - Client ID looks like: `123456789-abc...xyz.apps.googleusercontent.com`
   - Client Secret looks like: `GOCSPX-abc...xyz`

### Step 5: Save Google Credentials
Add these to your root `.env` file (in the project root):
```env
GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret-here
GOOGLE_REDIRECT_URI=http://localhost:3000/api/integrations/google/callback
```

---

## Part 2: Notion OAuth Setup

### Step 1: Create Notion Integration
1. Go to: https://www.notion.so/my-integrations
2. Sign in if needed
3. Click "+ New integration" button
4. Fill in the form:
   - **Name**: Canvas Assignments Sync
   - **Associated workspace**: Select your workspace
   - **Type**: Select **"Public"** (important - this enables OAuth)
   - **Capabilities**: 
     - ✅ Check "Read content"
     - ✅ Check "Update content"
     - ✅ Check "Insert content" (if available)
5. Click "Submit"

### Step 2: Get OAuth Credentials
1. After creating, you'll see the integration page
2. Scroll down to "OAuth" section
3. Copy the **OAuth client ID** (looks like: `abc123...xyz`)
4. Copy the **OAuth client secret** (looks like: `secret_abc...xyz`)
5. In "Redirect URIs" section, click "Add redirect URI"
6. Add: `http://localhost:3000/api/integrations/notion/callback`
7. Click "Save changes"

### Step 3: Get Notion Page ID
You need a page where databases will be created:

1. Open any Notion page in your workspace (or create a new one)
2. Click the "..." menu (three dots) in the top right
3. Click "Copy link"
4. The URL will look like: `https://www.notion.so/PageName-abc123def456...xyz789`
5. Extract the page ID:
   - It's the part after the last dash: `abc123def456...xyz789`
   - It's 32 characters long (with dashes)
   - Example: If URL is `https://www.notion.so/MyPage-abc123def456ghi789jkl012mno345pq`, the ID is `abc123def456ghi789jkl012mno345pq`

### Step 4: Save Notion Credentials
Add these to your root `.env` file (in the project root):
```env
NOTION_CLIENT_ID=your-oauth-client-id-here
NOTION_CLIENT_SECRET=your-oauth-client-secret-here
NOTION_REDIRECT_URI=http://localhost:3000/api/integrations/notion/callback
NOTION_PARENT_PAGE_ID=your-32-char-page-id-here
```

---

## Part 3: Generate Encryption Key

Run this command in your terminal:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output (64 characters) and add to your root `.env` file:
```env
INTEGRATIONS_TOKEN_ENC_KEY=your-64-character-hex-string-here
```

---

## Part 4: Verify Supabase Configuration

Make sure these are in your root `.env` file:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key-here
```

---

## Part 5: Complete Setup Checklist

- [ ] Google Cloud project created
- [ ] Google Sheets API enabled
- [ ] OAuth consent screen configured
- [ ] OAuth client ID and secret copied
- [ ] Google credentials added to `.env`
- [ ] Notion integration created (Public type)
- [ ] Notion OAuth credentials copied
- [ ] Notion redirect URI added
- [ ] Notion page ID obtained
- [ ] Notion credentials added to `.env`
- [ ] Encryption key generated and added to `.env`
- [ ] Supabase credentials verified in `.env`
- [ ] Backend server restarted

---

## Part 6: Test the Integration

1. **Restart your backend server**:
   ```bash
   cd backend
   npm run dev
   ```

2. **Test Google Sheets**:
   - Open your app: http://localhost:5173/calendar
   - Click "Export" dropdown
   - Click "Google Sheets"
   - Complete OAuth flow
   - Check that a spreadsheet was created

3. **Test Notion**:
   - Click "Export" > "Notion"
   - Complete OAuth flow
   - Check your Notion page for a new database

---

## Troubleshooting

**"Missing env var" error**
→ Check that all variables are in your root `.env` file and server was restarted

**OAuth redirect error**
→ Verify redirect URIs match exactly (including http vs https, trailing slashes)

**"Cannot POST /api/integrations/..." error**
→ Restart backend server after installing packages

**Notion database not created**
→ Verify NOTION_PARENT_PAGE_ID is correct (32 chars, from page URL)

---

## Next Steps

Once everything is working:
1. Update redirect URIs for production
2. Create separate OAuth apps for production
3. Set up daily sync job (see main setup guide)

