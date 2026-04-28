#!/usr/bin/env node
/**
 * Run `supabase link` using SUPABASE_PROJECT_REF from .env.local (never hardcode project ref).
 */
const { execSync } = require("child_process");
const { requireProjectRef } = require("./supabase-env.cjs");

const ref = requireProjectRef();
execSync(`supabase link --project-ref ${ref}`, { stdio: "inherit" });
