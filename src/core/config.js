// Load .env from root directory (already loaded by server.js, but ensure it's loaded here too)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

function getRequiredEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
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
  getSupabaseConfig,
};
