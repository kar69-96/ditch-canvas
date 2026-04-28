/**
 * Load .env.local from frontend/ or repo root; resolve Supabase project ref from env only (no hardcoded IDs).
 */
const path = require("path");
const fs = require("fs");

function loadEnvLocal() {
  const candidates = [
    path.join(__dirname, ".env.local"),
    path.join(__dirname, "..", ".env.local"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      require("dotenv").config({ path: p });
      return;
    }
  }
}

function requireProjectRef() {
  loadEnvLocal();
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!ref || !String(ref).trim()) {
    console.error(
      "❌ SUPABASE_PROJECT_REF is required. Set it in .env.local (Supabase → Project Settings → General → Reference ID).",
    );
    process.exit(1);
  }
  return String(ref).trim();
}

module.exports = { loadEnvLocal, requireProjectRef };
