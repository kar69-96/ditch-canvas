// Load .env from root directory (already loaded by server.js, but ensure it's loaded here too)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

function getRequiredEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getBrowserlessConfig(overrides = {}) {
  // Check if using Browserless Cloud (has BROWSERLESS_API_TOKEN)
  const cloudToken = overrides.apiToken || process.env.BROWSERLESS_API_TOKEN || '';
  const useCloud = !!cloudToken;
  
  let wsUrl, httpUrl, token;
  
  if (useCloud) {
    // Browserless Cloud endpoint - Playwright native protocol
    wsUrl = 'wss://production-sfo.browserless.io/chromium/playwright';
    httpUrl = 'https://production-sfo.browserless.io';
    token = cloudToken;
  } else {
    // Self-hosted Browserless
    const baseWs = overrides.wsUrl || process.env.BROWSERLESS_WS || process.env.BROWSERLESS_URL || 'ws://localhost:3000';
    const wsPath = overrides.wsPath || process.env.BROWSERLESS_WS_PATH || '/playwright';
    const baseWsTrimmed = baseWs.endsWith('/') ? baseWs.slice(0, -1) : baseWs;
    const pathNormalized = wsPath.startsWith('/') ? wsPath : `/${wsPath}`;
    
    if (baseWsTrimmed.includes(pathNormalized)) {
      wsUrl = baseWsTrimmed;
    } else {
      wsUrl = `${baseWsTrimmed}${pathNormalized}`;
    }

    const derivedHttp = baseWsTrimmed.replace(/^ws/i, 'http').replace(/\/playwright$/i, '');
    httpUrl = overrides.httpUrl || process.env.BROWSERLESS_HTTP || derivedHttp;
    token = overrides.token || process.env.BROWSERLESS_TOKEN || '';
  }
  
  const canvasUrl =
    overrides.canvasUrl ||
    process.env.CANVAS_URL ||
    process.env.CANVAS_LOGIN_URL ||
    'https://canvas.colorado.edu';

  return {
    wsUrl,
    httpUrl,
    token,
    canvasUrl,
    useCloud,
  };
}

function getSupabaseConfig(overrides = {}) {
  const url = overrides.url || process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL;
  const serviceKey = overrides.serviceKey || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = overrides.bucket || process.env.SUPABASE_STORAGE_BUCKET || 'user-data';

  return {
    url: getRequiredEnv('SUPABASE_URL', url),
    serviceKey: getRequiredEnv('SUPABASE_SERVICE_KEY', serviceKey),
    bucket,
  };
}

module.exports = {
  getBrowserlessConfig,
  getSupabaseConfig,
};
