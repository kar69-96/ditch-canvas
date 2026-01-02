# Notion Integration Setup - Quick Steps

Follow these steps to complete the Notion setup:

## Step 1: Go to Notion Integrations
Open: https://www.notion.so/my-integrations

(You'll need to sign in if not already)

## Step 2: Create New Integration
1. Click **"+ New integration"** button
2. Fill in:
   - **Name**: `Canvas Assignments Sync`
   - **Associated workspace**: Select your workspace
   - **Type**: Select **"Public"** ⚠️ (This is important - enables OAuth)
   - **Capabilities**: 
     - ✅ Check "Read content"
     - ✅ Check "Update content"
3. Click **"Submit"**

## Step 3: Get OAuth Credentials
After creating, you'll see the integration page:

1. Scroll to **"OAuth"** section
2. Copy the **OAuth client ID** (looks like: `abc123...xyz`)
3. Copy the **OAuth client secret** (looks like: `secret_abc...xyz`)

## Step 4: Add Redirect URI
1. In the same OAuth section, find **"Redirect URIs"**
2. Click **"Add redirect URI"**
3. Enter: `http://localhost:3000/api/integrations/notion/callback`
4. Click **"Save changes"**

## Step 5: Get Notion Page ID
You need a page where databases will be created:

1. Open any Notion page in your workspace (or create a new one)
2. Click the **"..."** menu (three dots) in the top right
3. Click **"Copy link"**
4. The URL looks like: `https://www.notion.so/PageName-abc123def456...xyz789`
5. Extract the **page ID**:
   - It's the part after the last dash
   - It's 32 characters long (may include dashes)
   - Example: If URL is `https://www.notion.so/MyPage-abc123def456ghi789jkl012mno345pq`
   - The ID is: `abc123def456ghi789jkl012mno345pq`

## Step 6: Add Credentials to .env

You have two options:

### Option A: Use the helper script (Easiest)
```bash
cd backend
node scripts/add-notion-credentials.js <client-id> <client-secret> <page-id>
```

Example:
```bash
node scripts/add-notion-credentials.js abc123xyz secret_abc123xyz abc123def456ghi789jkl012mno345pq
```

### Option B: Manually edit root .env
Open your root `.env` file (in the project root) and replace:
- `NOTION_CLIENT_ID=Your Notion OAuth Client ID` → `NOTION_CLIENT_ID=abc123...xyz`
- `NOTION_CLIENT_SECRET=Your Notion OAuth Client Secret` → `NOTION_CLIENT_SECRET=secret_abc...xyz`
- `NOTION_PARENT_PAGE_ID=Your Notion page ID (32 characters)` → `NOTION_PARENT_PAGE_ID=abc123def456...xyz789`

## Step 7: Restart Backend Server
```bash
cd backend
npm run dev
```

## Step 8: Test
1. Open your app: http://localhost:5173/calendar
2. Click **"Export"** dropdown
3. Click **"Notion"**
4. Complete OAuth flow
5. Check your Notion page - you should see a new "Assignments Sync" database

---

## Troubleshooting

**"Missing env var: NOTION_CLIENT_ID"**
→ Make sure you edited the root `.env` file (in the project root)

**OAuth redirect error**
→ Verify redirect URI in Notion matches exactly: `http://localhost:3000/api/integrations/notion/callback`

**Database not created**
→ Check that NOTION_PARENT_PAGE_ID is correct (32 chars from page URL)

