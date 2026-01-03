const express = require('express');
const { google } = require('googleapis');
const crypto = require('crypto');
const fetch = (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));

const { getSupabaseClient } = require('../services/integrations/supabase-client');
const { encryptToken } = require('../services/integrations/token-crypto');
const { runAllSyncs } = require('../services/integrations/sync-orchestrator');

const router = express.Router();

// ---------- Helpers ----------

function requireEnv(name) {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing env var: ${name}`);
  }
  return val;
}

function encodeState(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function decodeState(str) {
  return JSON.parse(Buffer.from(str, 'base64url').toString('utf-8'));
}

function wantsHtml(req) {
  const accept = req.headers.accept || '';
  return accept.includes('text/html');
}

function sendSuccess(res, payload) {
  if (wantsHtml(res.req)) {
    const safePayload = JSON.stringify(payload || {});
    const provider = payload?.provider || 'integration';
    const linkText = provider === 'google' ? 'spreadsheet' : 'database';
    const statusText = provider === 'google' ? 'Opening spreadsheet...' : 'Opening database...';
    return res.send(
      `<html><head><title>Integration Connected</title></head><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h2 style="color: #4CAF50;">✅ Integration Connected!</h2>
        <p>Your assignments are being synced...</p>
        <p id="status">${statusText}</p>
        <script>
        (function() {
          const data = ${safePayload};
          const statusEl = document.getElementById('status');
          
          function openLink() {
            if (data.redirectUrl) {
              try {
                // Try to open in new tab
                const newWindow = window.open(data.redirectUrl, '_blank');
                if (newWindow) {
                  statusEl.textContent = '${linkText.charAt(0).toUpperCase() + linkText.slice(1)} opened! You can close this window.';
                } else {
                  statusEl.innerHTML = 'Popup blocked. <a href=\"' + data.redirectUrl + '\" target=\"_blank\">Click here to open ${linkText}</a>';
                }
              } catch (err) {
                statusEl.innerHTML = 'Error opening ${linkText}. <a href=\"' + data.redirectUrl + '\" target=\"_blank\">Click here to open</a>';
              }
            }
          }
          
          try {
            // Send message to parent window first
            if (window.opener) {
              window.opener.postMessage({ 
                type: 'integration-success',
                provider: data.provider,
                redirectUrl: data.redirectUrl 
              }, '*');
            } else if (window.parent && window.parent !== window) {
              window.parent.postMessage({ 
                type: 'integration-success',
                provider: data.provider,
                redirectUrl: data.redirectUrl 
              }, '*');
            }
            
            // Open link immediately
            openLink();
            
            // Also try after a short delay (in case popup blocker needs user interaction)
            setTimeout(openLink, 500);
            
          } catch (err) {
            console.error('postMessage failed', err);
            openLink();
          }
          
          // Close window after 3 seconds
          setTimeout(() => {
            try {
              window.close();
            } catch (e) {
              // Window might not be closable if not opened by script
            }
          }, 3000);
        })();
        </script>
      </body></html>`
    );
  }
  return res.json(payload);
}

async function upsertIntegration({
  userEmail,
  provider,
  tokenCiphertext,
  tokenExpiresAt,
  externalTargetId,
  targetDisplayName,
}) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('integrations')
    .upsert(
      {
        user_email: userEmail,
        provider,
        token_ciphertext: tokenCiphertext,
        token_expires_at: tokenExpiresAt,
        external_target_id: externalTargetId,
        target_display_name: targetDisplayName,
        status: 'active',
        last_sync_error: null,
      },
      { onConflict: 'user_email,provider' }
    );

  if (error) {
    throw new Error(`Failed to upsert integration: ${error.message}`);
  }
}

async function listIntegrations(userEmail) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('integrations')
    .select(
      'id,user_email,provider,status,external_target_id,target_display_name,target_config,last_sync_at,last_sync_status,last_sync_error,created_at,updated_at'
    )
    .eq('user_email', userEmail);
  if (error) {
    throw new Error(`Failed to fetch integrations: ${error.message}`);
  }
  return data || [];
}

async function deleteIntegration(userEmail, provider) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('integrations')
    .delete()
    .eq('user_email', userEmail)
    .eq('provider', provider);
  if (error) {
    throw new Error(`Failed to delete integration: ${error.message}`);
  }
}

// ---------- Google OAuth ----------

function getGoogleClient() {
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');
  const redirectUri = requireEnv('GOOGLE_REDIRECT_URI');
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

async function createGoogleSheet(authClient) {
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: 'Assignments Sync' },
      sheets: [
        {
          properties: { title: 'Assignments' },
        },
      ],
    },
  });
  const spreadsheetId = res.data.spreadsheetId;
  const title = res.data.properties?.title || 'Assignments Sync';
  // Initialize header row with new format
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Assignments!A1:H1',
    valueInputOption: 'RAW',
    requestBody: {
      values: [
        ['Date', 'Assignment', 'Course', 'Due Time', 'Points', 'Status', 'URL', 'Completed'],
      ],
    },
  });
  
  // Get the actual sheet ID
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetId = spreadsheet.data.sheets[0]?.properties?.sheetId;
  if (sheetId === undefined && sheetId !== 0) {
    throw new Error('Could not find sheet ID');
  }
  
  // Format header row
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.2, green: 0.4, blue: 0.8 },
                textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
                horizontalAlignment: 'CENTER',
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
          },
        },
        {
          updateSheetProperties: {
            properties: {
              sheetId: sheetId,
              gridProperties: {
                frozenRowCount: 1,
              },
            },
            fields: 'gridProperties.frozenRowCount',
          },
        },
      ],
    },
  });
  
  return { spreadsheetId, title };
}

// ---------- Notion OAuth ----------

async function exchangeNotionCode(code) {
  const clientId = requireEnv('NOTION_CLIENT_ID');
  const clientSecret = requireEnv('NOTION_CLIENT_SECRET');
  const redirectUri = requireEnv('NOTION_REDIRECT_URI');

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://api.notion.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion token exchange failed: ${text}`);
  }
  return res.json();
}

async function findAccessibleNotionPage(accessToken) {
  const { Client } = require('@notionhq/client');
  const notion = new Client({ auth: accessToken });

  try {
    // Search for accessible pages
    const searchResponse = await notion.search({
      filter: { property: 'object', value: 'page' },
      page_size: 10,
    });

    // Return the first accessible page
    if (searchResponse.results && searchResponse.results.length > 0) {
      const firstPage = searchResponse.results[0];
      return firstPage.id;
    }

    throw new Error('No accessible pages found');
  } catch (error) {
    if (error.code === 'object_not_found' || error.message?.includes('No accessible pages')) {
      throw new Error(
        'No accessible Notion pages found. ' +
        'Please share at least one page with the integration during OAuth, ' +
        'or manually share a page with "Canvas Assignments Sync" integration.'
      );
    }
    throw error;
  }
}

async function createNotionDatabase(accessToken, parentPageId = null) {
  const { Client } = require('@notionhq/client');
  const notion = new Client({ auth: accessToken });
  const title = 'Assignments Sync';

  // If no parentPageId provided, try to find one automatically
  let normalizedPageId = parentPageId;
  
  if (!normalizedPageId) {
    try {
      normalizedPageId = await findAccessibleNotionPage(accessToken);
    } catch (error) {
      throw new Error(
        `Could not find an accessible Notion page. ${error.message} ` +
        'Make sure to share at least one page with the integration during OAuth.'
      );
    }
  }

  // Normalize page ID (remove dashes, spaces, and extract just the ID part)
  // Notion page IDs are 32 characters (UUID without dashes)
  normalizedPageId = normalizedPageId.trim();
  
  // If it's a full URL, extract the ID
  if (normalizedPageId.includes('notion.so/')) {
    const match = normalizedPageId.match(/[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
    if (match) {
      normalizedPageId = match[0];
    }
  }
  
  // Remove dashes to get 32-char UUID
  normalizedPageId = normalizedPageId.replace(/-/g, '');
  
  // Add dashes back in UUID format: 8-4-4-4-12
  if (normalizedPageId.length === 32) {
    normalizedPageId = [
      normalizedPageId.slice(0, 8),
      normalizedPageId.slice(8, 12),
      normalizedPageId.slice(12, 16),
      normalizedPageId.slice(16, 20),
      normalizedPageId.slice(20, 32)
    ].join('-');
  }

  try {
    const response = await notion.databases.create({
      parent: { page_id: normalizedPageId },
      title: [
        {
          type: 'text',
          text: { content: title },
        },
      ],
      properties: {
        Name: { title: {} },
        Course: { rich_text: {} },
        Due: { date: {} },
        Points: { number: {} },
        Status: { select: { options: [{ name: 'pending' }, { name: 'submitted' }, { name: 'graded' }] } },
        URL: { url: {} },
      },
    });

    // Construct Notion database URL
    // Correct format: https://www.notion.so/{databaseIdWithoutDashes}
    // Example: https://www.notion.so/2dd0d9fedeba81fea804c7c28eb5415c
    // Database IDs from API have dashes (UUID format), but URLs need them removed
    const databaseIdWithoutDashes = response.id.replace(/-/g, '');
    const databaseUrl = `https://www.notion.so/${databaseIdWithoutDashes}`;

    return {
      databaseId: response.id,
      title,
      databaseUrl,
      parentPageId: normalizedPageId,
    };
  } catch (error) {
    // Provide helpful error messages for common issues
    if (error.code === 'object_not_found' || error.message?.includes('Could not find page')) {
      const integrationName = process.env.NOTION_INTEGRATION_NAME || 'Canvas Assignments Sync';
      throw new Error(
        `Could not find page with ID: ${normalizedPageId}. ` +
        `Make sure the page is shared with your integration "${integrationName}". ` +
        `To fix: Open the page in Notion → Click "..." menu → "Add connections" → Select "${integrationName}"`
      );
    }
    if (error.code === 'restricted_resource') {
      throw new Error(
        `Access denied to page ${normalizedPageId}. ` +
        `The page must be shared with your integration. ` +
        `Open the page in Notion → Click "..." → "Add connections" → Select your integration`
      );
    }
    // Re-throw with original message for other errors
    throw error;
  }
}

// ---------- Routes ----------

// GET /api/integrations?userEmail=...
router.get('/', async (req, res) => {
  try {
    const userEmail = req.query.userEmail;
    if (!userEmail) {
      return res.status(400).json({ error: 'userEmail is required' });
    }
    const integrations = await listIntegrations(userEmail);
    res.json({ integrations });
  } catch (error) {
    console.error('[integrations] list error', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/integrations/:provider/connect
router.post('/:provider/connect', async (req, res) => {
  try {
    const { provider } = req.params;
    const { userEmail } = req.body || {};
    if (!userEmail) {
      return res.status(400).json({ error: 'userEmail is required' });
    }
    const state = encodeState({ provider, userEmail, nonce: crypto.randomUUID() });

    if (provider === 'google') {
      const oauth2Client = getGoogleClient();
      const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/spreadsheets'],
        prompt: 'consent',
        state,
      });
      return res.json({ authUrl: url });
    }

    if (provider === 'notion') {
      const clientId = requireEnv('NOTION_CLIENT_ID');
      const redirectUri = requireEnv('NOTION_REDIRECT_URI');
      const authUrl = new URL('https://api.notion.com/v1/oauth/authorize');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('owner', 'user');
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('state', state);
      return res.json({ authUrl: authUrl.toString() });
    }

    return res.status(400).json({ error: 'Unsupported provider' });
  } catch (error) {
    console.error('[integrations] connect error', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/integrations/:provider/callback
router.get('/:provider/callback', async (req, res) => {
  try {
    const { provider } = req.params;
    const { code, state } = req.query;
    if (!code || !state) {
      return res.status(400).json({ error: 'code and state are required' });
    }

    const decoded = decodeState(state);
    const userEmail = decoded.userEmail;
    if (!userEmail) {
      return res.status(400).json({ error: 'Missing userEmail in state' });
    }

    if (provider === 'google') {
      const oauth2Client = getGoogleClient();
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      const { spreadsheetId, title } = await createGoogleSheet(oauth2Client);
      const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

      const tokenCiphertext = encryptToken(tokens);
      await upsertIntegration({
        userEmail,
        provider: 'google',
        tokenCiphertext,
        tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        externalTargetId: spreadsheetId,
        targetDisplayName: title,
      });

      // Trigger a sync so the sheet gets populated right away
      try {
        await runAllSyncs();
      } catch (syncErr) {
        console.error('[integrations] post-auth sync failed', syncErr);
      }

      return sendSuccess(res, {
        success: true,
        provider: 'google',
        externalTargetId: spreadsheetId,
        redirectUrl: sheetUrl,
      });
    }

    if (provider === 'notion') {
      const tokenResponse = await exchangeNotionCode(code);
      const accessToken = tokenResponse.access_token;
      const expiresIn = tokenResponse.expires_in;

      // Get parentPageId from state (optional - will auto-detect if not provided)
      const parentPageId = decoded.parentPageId || null;

      const { databaseId, title, databaseUrl } = await createNotionDatabase(accessToken, parentPageId);
      const tokenCiphertext = encryptToken(tokenResponse);

      await upsertIntegration({
        userEmail,
        provider: 'notion',
        tokenCiphertext,
        tokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
        externalTargetId: databaseId,
        targetDisplayName: title,
      });

      try {
        await runAllSyncs();
      } catch (syncErr) {
        console.error('[integrations] post-auth sync failed', syncErr);
      }

      return sendSuccess(res, {
        success: true,
        provider: 'notion',
        externalTargetId: databaseId,
        redirectUrl: databaseUrl,
      });
    }

    return res.status(400).json({ error: 'Unsupported provider' });
  } catch (error) {
    console.error('[integrations] callback error', error);
    // Send error message to frontend if HTML request
    if (wantsHtml(req)) {
      return res.send(
        `<html><body><p>Error: ${error.message}</p><script>
          (function() {
            try {
              if (window.opener) {
                window.opener.postMessage({ 
                  type: 'integration-error',
                  message: ${JSON.stringify(error.message)}
                }, '*');
              } else if (window.parent && window.parent !== window) {
                window.parent.postMessage({ 
                  type: 'integration-error',
                  message: ${JSON.stringify(error.message)}
                }, '*');
              }
            } catch (e) {
              console.error('Failed to send error message', e);
            }
            setTimeout(() => window.close(), 2000);
          })();
        </script></body></html>`
      );
    }
    res.status(500).json({ error: error.message });
  }
});

// POST /api/integrations/:provider/sync
router.post('/:provider/sync', async (req, res) => {
  try {
    const { provider } = req.params;
    const { userEmail, completedAssignmentIds } = req.body || {};
    if (!userEmail) {
      return res.status(400).json({ error: 'userEmail is required' });
    }

    // Get the integration
    const integrations = await listIntegrations(userEmail);
    const integration = integrations.find(i => i.provider === provider);
    
    if (!integration) {
      return res.status(404).json({ error: 'Integration not found. Please connect first.' });
    }

    if (integration.status !== 'active') {
      return res.status(400).json({ error: `Integration is ${integration.status}. Please reconnect.` });
    }

    // Completion status is now stored in Supabase assignment entities (single source of truth)
    // No need to store completedAssignmentIds in integration config anymore

    // Run sync for this specific integration
    try {
      await runAllSyncs();
    } catch (syncErr) {
      console.error('[integrations] sync error', syncErr);
      return res.status(500).json({ error: `Sync failed: ${syncErr.message}` });
    }

    // Return the sheet/database URL
    let redirectUrl = null;
    if (provider === 'google') {
      redirectUrl = `https://docs.google.com/spreadsheets/d/${integration.external_target_id}`;
    } else if (provider === 'notion') {
      // Notion database URL format: https://www.notion.so/{databaseIdWithoutDashes}
      const databaseIdWithoutDashes = integration.external_target_id.replace(/-/g, '');
      redirectUrl = `https://www.notion.so/${databaseIdWithoutDashes}`;
    }

    res.json({ 
      success: true,
      redirectUrl,
      lastSyncAt: integration.last_sync_at,
    });
  } catch (error) {
    console.error('[integrations] sync error', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/integrations/:provider
router.delete('/:provider', async (req, res) => {
  try {
    const { provider } = req.params;
    const { userEmail } = req.body || {};
    if (!userEmail) {
      return res.status(400).json({ error: 'userEmail is required' });
    }
    await deleteIntegration(userEmail, provider);
    res.json({ success: true });
  } catch (error) {
    console.error('[integrations] delete error', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/integrations/run-daily-sync
router.post('/run-daily-sync', async (req, res) => {
  try {
    const cronSecret = process.env.INTEGRATIONS_CRON_SECRET;
    if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const result = await runAllSyncs();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[integrations] run-daily-sync error', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

