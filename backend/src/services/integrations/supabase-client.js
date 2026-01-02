const { createClient } = require('@supabase/supabase-js');
const { getSupabaseConfig } = require('../../core/config');

let cached;

function getSupabaseClient() {
  if (cached) return cached;
  const config = getSupabaseConfig();
  cached = createClient(config.url, config.serviceKey);
  return cached;
}

module.exports = { getSupabaseClient };




