// Simple OAuth server to use default Google/Microsoft connection screens
// Requires Node.js 18+ (global fetch) and the following env vars set:
// - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
// - MS_CLIENT_ID, MS_CLIENT_SECRET, MS_TENANT_ID, MS_REDIRECT_URI
// - SESSION_SECRET

import express from 'express'
import cookieSession from 'cookie-session'
import multer from 'multer'
import crypto from 'crypto'
import path from 'path'
import { createRequire } from 'module'

// Enable requiring CommonJS modules from assignments-api-pack in ESM context
const require = createRequire(import.meta.url)

const app = express()
app.use(express.json({ limit: '100mb' }))
app.use(express.urlencoded({ limit: '100mb', extended: true }))
const upload = multer({ limits: { fileSize: 100 * 1024 * 1024 } })
app.use(cookieSession({
  name: 'sess',
  secret: process.env.SESSION_SECRET || 'dev-secret',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  secure: process.env.NODE_ENV === 'production',
}))

// CORS for local dev (adjust for prod)
app.use((req, res, next) => {
  const origin = req.headers.origin || 'http://127.0.0.1:8001'
  res.header('Access-Control-Allow-Origin', origin)
  res.header('Vary', 'Origin')
  res.header('Access-Control-Allow-Credentials', 'true')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(200)
  next()
})

// Mount assignments API pack and add summary/courses endpoints for the frontend
try {
  const assignmentsRoutes = require('../assignments-api-pack/routes/assignments.js')
  app.use('/api/extraction', assignmentsRoutes)
  console.log('Mounted assignments API pack routes at /api/extraction')
} catch (e) {
  console.warn('Failed to mount assignments API pack routes:', e?.message)
}

try {
  const ExtractionDataService = require('../assignments-api-pack/services/extraction-data-service.js')
  const dataService = new ExtractionDataService()

  // GET /api/extraction/summary
  app.get('/api/extraction/summary', async (req, res) => {
    try {
      const all = await dataService.getAllCoursesWithData()
      let totals = { submitted: 0, unsubmitted: 0, graded: 0, missing: 0, points: 0 }
      all.courses.forEach((c) => {
        totals.submitted += c.stats?.submitted || 0
        totals.unsubmitted += c.stats?.unsubmitted || 0
        totals.graded += c.stats?.graded || 0
        const missing = (c.assignments || []).filter((a) => a.submissionStatus === 'missing').length
        totals.missing += missing
        totals.points += c.stats?.totalPoints || 0
      })
      const payload = {
        totalCourses: all.metadata?.totalCourses || all.courses?.length || 0,
        totalAssignments: all.metadata?.totalAssignments || (all.courses || []).reduce((s, c) => s + (c.assignmentCount || (c.assignments?.length || 0)), 0),
        totalPoints: totals.points,
        statusBreakdown: {
          submitted: totals.submitted,
          unsubmitted: totals.unsubmitted,
          graded: totals.graded,
          missing: totals.missing,
        },
        upcomingAssignments: 0,
        overdueAssignments: 0,
        lastExtracted: all.metadata?.extractedAt || new Date().toISOString(),
      }
      res.json({ success: true, data: payload, metadata: { timestamp: new Date().toISOString(), type: 'summary' } })
    } catch (err) {
      res.status(500).json({ success: false, data: null, error: { code: 'SUMMARY_FAILED', message: String(err?.message || err), statusCode: 500 } })
    }
  })

  // GET /api/extraction/courses
  app.get('/api/extraction/courses', async (req, res) => {
    try {
      const all = await dataService.getAllCoursesWithData()
      const base = process.env.CANVAS_BASE_URL || process.env.DEFAULT_CANVAS_URL || 'https://canvas.example.com'
      let list = (all.courses || []).map((c) => ({
        id: String(c.id),
        name: c.name,
        courseCode: c.courseCode || c.name?.split(':')?.[0]?.trim() || c.name,
        assignmentCount: c.assignmentCount || (c.assignments?.length || 0),
        totalPoints: c.stats?.totalPoints || 0,
        url: `${base.replace(/\/$/, '')}/courses/${c.id}`,
      }))

      const limit = Math.min(Number(req.query.limit) || 50, 100)
      const offset = Number(req.query.offset) || 0
      const search = (req.query.search || '').toString().toLowerCase()
      const sort = (req.query.sort || 'name').toString()
      const order = (req.query.order || 'asc').toString().toLowerCase()
      if (search) list = list.filter((c) => c.name.toLowerCase().includes(search) || c.courseCode.toLowerCase().includes(search))
      list.sort((a, b) => {
        let val = 0
        if (sort === 'assignmentCount') val = (a.assignmentCount || 0) - (b.assignmentCount || 0)
        else val = a.name.localeCompare(b.name)
        return order === 'desc' ? -val : val
      })
      const total = list.length
      const paged = list.slice(offset, offset + limit)
      res.json({
        success: true,
        data: paged,
        metadata: {
          timestamp: new Date().toISOString(),
          totalCourses: total,
          pagination: { total, returned: paged.length, limit, offset, hasMore: offset + limit < total },
        },
      })
    } catch (err) {
      res.status(500).json({ success: false, data: null, error: { code: 'COURSES_FAILED', message: String(err?.message || err), statusCode: 500 } })
    }
  })

  // GET /api/extraction/debug — visibility into server wiring and data source
  app.get('/api/extraction/debug', async (req, res) => {
    try {
      const supa = (() => {
        try { return require('../assignments-api-pack/models/supabase-models.js') } catch { return null }
      })()
      const supabaseConfigured = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
      const supabaseConnected = supa?.SupabaseConnection ? (await supa.SupabaseConnection.testConnection()) : false
      const schemaReady = (() => dataService?.checkSupabaseSchema ? true : false) && supabaseConnected
      let source = 'unknown', counts = { courses: 0, assignments: 0 }
      try {
        const all = await dataService.getAllCoursesWithData()
        source = all?.metadata?.source || 'unknown'
        counts.courses = all?.courses?.length || 0
        counts.assignments = all?.metadata?.totalAssignments || 0
      } catch {}
      res.json({
        success: true,
        data: {
          env: {
            SUPABASE_URL: !!process.env.SUPABASE_URL,
            SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
            EXTRACTOR_WEBHOOK_URL: !!process.env.EXTRACTOR_WEBHOOK_URL,
            EXTRACTOR_COMMAND: !!process.env.EXTRACTOR_COMMAND,
          },
          supabase: { configured: supabaseConfigured, connected: supabaseConnected, schemaReady },
          dataSource: { source, counts },
        },
        metadata: { timestamp: new Date().toISOString() },
      })
    } catch (err) {
      res.status(500).json({ success: false, data: null, error: { code: 'DEBUG_FAILED', message: String(err?.message || err), statusCode: 500 } })
    }
  })

  // POST /api/extraction/refresh — invalidate caches and signal a fresh read
  app.post('/api/extraction/refresh', async (req, res) => {
    try {
      if (typeof ExtractionDataService.invalidateAll === 'function') {
        ExtractionDataService.invalidateAll()
      } else if (typeof dataService.clearCache === 'function') {
        dataService.clearCache()
      }
      // Optionally return a quick summary so the client can update immediately
      const all = await dataService.getAllCoursesWithData()
      res.json({ success: true, data: { totalCourses: all.courses?.length || 0, totalAssignments: all.metadata?.totalAssignments || 0 }, metadata: { timestamp: new Date().toISOString(), action: 'refreshed' } })
    } catch (err) {
      res.status(500).json({ success: false, data: null, error: { code: 'REFRESH_FAILED', message: String(err?.message || err), statusCode: 500 } })
    }
  })

  // POST /api/extraction/trigger — placeholder to kick off headless extraction if configured
  app.post('/api/extraction/trigger', async (req, res) => {
    try {
      // If an external webhook is configured, fire-and-forget
      const webhook = process.env.EXTRACTOR_WEBHOOK_URL
      if (webhook) {
        // Non-blocking notify (best-effort)
        fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'extract', requestedAt: new Date().toISOString() }) }).catch(() => {})
      }
      // If a local command is configured, spawn it detached
      const command = process.env.EXTRACTOR_COMMAND
      if (command) {
        try {
          const { spawn } = await import('node:child_process')
          const child = spawn(command, { shell: true, stdio: 'ignore', detached: true })
          child.unref()
        } catch (e) {
          console.warn('Extractor command failed to spawn:', e?.message)
        }
      }
      // Invalidate cache so subsequent reads pull new data when available
      if (typeof ExtractionDataService.invalidateAll === 'function') {
        ExtractionDataService.invalidateAll()
      } else if (typeof dataService.clearCache === 'function') {
        dataService.clearCache()
      }
      res.status(202).json({ success: true, data: { queued: !!webhook || !!command }, metadata: { timestamp: new Date().toISOString(), message: webhook || command ? 'Extraction triggered' : 'Cache invalidated' } })
    } catch (err) {
      res.status(500).json({ success: false, data: null, error: { code: 'TRIGGER_FAILED', message: String(err?.message || err), statusCode: 500 } })
    }
  })
} catch (e) {
  console.warn('Extraction summary/courses endpoints not available:', e?.message)
}

// Helpers (PKCE)
function base64url(input) {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function createPkce() {
  const verifier = base64url(crypto.randomBytes(32))
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest())
  const state = base64url(crypto.randomBytes(16))
  return { verifier, challenge, state }
}

// Auth status
app.get('/api/auth/status', (req, res) => {
  const google = !!req.session?.googleTokens
  const microsoft = !!req.session?.msTokens
  res.json({ google, microsoft })
})

// Simple health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Server running', routes: ['POST /api/extraction/import'] })
})

// Google OAuth
app.get('/api/auth/google', (req, res) => {
  const usePkce = process.env.GOOGLE_PKCE !== 'false'
  const { verifier, challenge, state } = createPkce()
  if (usePkce) req.session.pkce = { provider: 'google', verifier, state }
  else req.session.pkce = { provider: 'google', verifier: null, state }
  req.session.postAuthRedirect = req.query.redirect || process.env.APP_BASE_URL || 'http://127.0.0.1:8001'
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    redirect_uri: process.env.GOOGLE_REDIRECT_URI || '',
    response_type: 'code',
    scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
    access_type: 'offline',
    prompt: 'consent',
    ...(usePkce ? { code_challenge: challenge, code_challenge_method: 'S256' } : {}),
    state,
  })
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  res.redirect(url)
})

// Handle Google OAuth callback (supports both /callback and trailing-slash style if configured)
async function handleGoogleCallback(req, res) {
  const { code, state } = req.query
  if (!req.session?.pkce || req.session.pkce.provider !== 'google' || state !== req.session.pkce.state) {
    return res.status(400).send('Invalid state')
  }
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirect_uri: process.env.GOOGLE_REDIRECT_URI || '',
    grant_type: 'authorization_code',
    code: String(code),
    ...(req.session.pkce?.verifier ? { code_verifier: req.session.pkce.verifier } : {}),
  })
  const resp = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body })
  if (!resp.ok) return res.status(500).send('Token exchange failed')
  const tokens = await resp.json()
  const now = Date.now()
  const expires_at = tokens.expires_in ? now + Number(tokens.expires_in) * 1000 : now + 3000 * 1000
  req.session.googleTokens = { ...tokens, expires_at }
  const redirectTo = req.session.postAuthRedirect || process.env.APP_BASE_URL || 'http://127.0.0.1:8001'
  delete req.session.pkce
  delete req.session.postAuthRedirect
  res.redirect(redirectTo)
}

app.get('/api/auth/google/callback', handleGoogleCallback)
app.get('/api/auth/google/', handleGoogleCallback)

// Microsoft OAuth
app.get('/api/auth/microsoft', (req, res) => {
  const { verifier, challenge, state } = createPkce()
  req.session.pkce = { provider: 'microsoft', verifier, state }
  req.session.postAuthRedirect = req.query.redirect || process.env.APP_BASE_URL || 'http://127.0.0.1:8001'
  const tenant = process.env.MS_TENANT_ID || 'common'
  const params = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID || '',
    redirect_uri: process.env.MS_REDIRECT_URI || '',
    response_type: 'code',
    response_mode: 'query',
    scope: 'openid email profile offline_access Files.ReadWrite',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })
  const url = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params}`
  res.redirect(url)
})

app.get('/api/auth/microsoft/callback', async (req, res) => {
  const { code, state } = req.query
  if (!req.session?.pkce || req.session.pkce.provider !== 'microsoft' || state !== req.session.pkce.state) {
    return res.status(400).send('Invalid state')
  }
  const tenant = process.env.MS_TENANT_ID || 'common'
  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID || '',
    client_secret: process.env.MS_CLIENT_SECRET || '',
    redirect_uri: process.env.MS_REDIRECT_URI || '',
    grant_type: 'authorization_code',
    code: String(code),
    code_verifier: req.session.pkce.verifier,
  })
  const resp = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, { method: 'POST', body })
  if (!resp.ok) return res.status(500).send('Token exchange failed')
  const tokens = await resp.json()
  req.session.msTokens = tokens
  const redirectTo = req.session.postAuthRedirect || process.env.APP_BASE_URL || 'http://127.0.0.1:8001'
  delete req.session.pkce
  delete req.session.postAuthRedirect
  res.redirect(redirectTo)
})

// Minimal file endpoints (stubs to prove wiring; replace with real API calls)
app.get('/api/assignments/:id/files', (req, res) => {
  const store = (req.session.filesStore ||= {})
  const list = store[req.params.id] || []
  res.json(list)
})
app.post('/api/assignments/:id/files', async (req, res) => {
  try {
    const { provider, kind, courseName, title } = req.body || {}
    if (!provider || !kind) return res.status(400).json({ error: 'provider and kind required' })
    if (provider === 'google') {
      const folderName = (courseName || 'Course').replace(/[\\/:*?"<>|]/g, '')
      const folderId = await ensureGoogleFolder(req, folderName)
      const mime = kind === 'sheet' ? 'application/vnd.google-apps.spreadsheet' : 'application/vnd.google-apps.document'
      const meta = await googleCreateFile(req, { name: title || 'Untitled', mimeType: mime, parents: [folderId] })
      const file = {
        id: meta.id,
        provider,
        kind,
        name: meta.name,
        url: meta.webViewLink,
        folder: folderName,
        createdAt: new Date().toISOString(),
      }
      const store = (req.session.filesStore ||= {})
      store[req.params.id] = [...(store[req.params.id] || []), file]
      return res.status(201).json(file)
    }
    // Microsoft stub (replace with Graph calls)
    const id = crypto.randomBytes(6).toString('hex')
    const url = `https://onedrive.live.com/?id=${id}`
    const file = {
      id,
      provider,
      kind,
      name: title || 'Untitled',
      url,
      folder: (courseName || 'Course').replace(/[\\/:*?"<>|]/g, ''),
      createdAt: new Date().toISOString(),
    }
    const store = (req.session.filesStore ||= {})
    store[req.params.id] = [...(store[req.params.id] || []), file]
    return res.status(201).json(file)
  } catch (e) {
    console.error('Create file error', e)
    res.status(500).json({ error: 'Failed to create file' })
  }
})

// Google helpers
async function ensureGoogleAccessToken(req) {
  const t = req.session.googleTokens
  if (!t) throw new Error('Google not connected')
  const now = Date.now()
  if (t.expires_at && t.expires_at - 60000 > now) return t.access_token
  if (!t.refresh_token) return t.access_token
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    grant_type: 'refresh_token',
    refresh_token: t.refresh_token,
  })
  const resp = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body })
  if (!resp.ok) throw new Error('Google token refresh failed')
  const data = await resp.json()
  const expires_at = data.expires_in ? now + Number(data.expires_in) * 1000 : now + 3000 * 1000
  req.session.googleTokens = { ...t, ...data, expires_at }
  return req.session.googleTokens.access_token
}

async function googleApi(req, path, init = {}) {
  const token = await ensureGoogleAccessToken(req)
  const resp = await fetch(`https://www.googleapis.com${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      ...(init.headers || {}),
    },
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Google API error ${resp.status}: ${text}`)
  }
  return resp.json()
}

async function ensureGoogleFolder(req, folderName) {
  // Look for folder in root
  const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${folderName.replace(/'/g, "\\'")}' and 'root' in parents and trashed=false`)
  const data = await googleApi(req, `/drive/v3/files?q=${q}&fields=files(id,name)`)
  if (data.files && data.files.length) return data.files[0].id
  const meta = await googleApi(req, '/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: ['root'] }),
  })
  return meta.id
}

async function googleCreateFile(req, { name, mimeType, parents }) {
  return googleApi(req, '/drive/v3/files?fields=id,name,webViewLink', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType, parents }),
  })
}

let pdfjsLibPromise = null
async function getPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs')
  }
  return pdfjsLibPromise
}

function chunkText(text, chunkSize = 6000, overlap = 400) {
  const clean = (text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const chunks = []
  let start = 0
  while (start < clean.length) {
    const end = Math.min(clean.length, start + chunkSize)
    chunks.push(clean.slice(start, end))
    if (end >= clean.length) break
    start = Math.max(0, end - overlap)
  }
  return chunks
}

function dedupeAssignments(items) {
  const map = new Map()
  for (const item of items) {
    const key = `${(item.title || '').toLowerCase()}|${item.dueDate || ''}`
    if (!map.has(key)) map.set(key, item)
  }
  return Array.from(map.values())
}

function normalizeAssignment(raw) {
  return {
    title: String(raw.title || 'Untitled'),
    courseName: String(raw.courseName || raw.course || 'Unknown Course'),
    dueDate: raw.dueDate ? new Date(raw.dueDate).toISOString() : null,
    description: String(raw.description || ''),
    pointsPossible: Number(raw.pointsPossible ?? raw.points ?? 0) || 0,
    status: String(raw.status || 'unsubmitted').toLowerCase(),
  }
}

async function extractTextFromPdf(buffer, maxPages = 60) {
  const pdfjs = await getPdfJs()
  const loadingTask = pdfjs.getDocument({ data: buffer, isEvalSupported: false, useSystemFonts: true })
  const pdf = await loadingTask.promise
  const segments = []
  const total = Math.min(pdf.numPages, maxPages)
  for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const items = content.items || []
    const merged = items.map((i) => i.str || '').join(' ')
    if (merged.trim()) segments.push(merged)
  }
  return segments.join('\n')
}

async function callAnthropicJSON(apiKey, body) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Anthropic request failed (${resp.status}): ${text.slice(0, 2000)}`)
  }
  const json = await resp.json()
  const text = (json?.content || [])
    .map((item) => item?.text || '')
    .join('\n') || ''
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new Error(`Failed to parse Anthropic JSON: ${(err?.message || '').slice(0, 200)}`)
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Anthropic did not return an array')
  }
  return parsed
}

async function extractAssignmentsFromPdf(buffer, name, apiKey) {
  const text = await extractTextFromPdf(buffer)
  if (!text || !text.trim()) {
    throw new Error('Unable to extract text from PDF')
  }
  const chunks = chunkText(text)
  const results = []
  const total = chunks.length || 1
  for (let i = 0; i < (chunks.length || 1); i += 1) {
    const chunk = chunks[i] || text
    const system = 'You are a precise extractor that outputs strict JSON.'
    const user = `Document: ${name}. Chunk ${i + 1} of ${total}. Extract every assignment from the text below. Respond ONLY with a JSON array.\nTEXT:\n${chunk}`
    const partial = await callAnthropicJSON(apiKey, {
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 2500,
      temperature: 0,
      system,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: user }],
        },
      ],
    })
    results.push(...partial)
  }
  return dedupeAssignments(results).map(normalizeAssignment)
}

async function extractAssignmentsFromImages(pdfPath, apiKey, maxPages = 8) {
  const tempDir = path.join('uploads', `vision_${Date.now()}`)
  fs.mkdirSync(tempDir, { recursive: true })
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn('pdftoppm', ['-r', '220', '-png', pdfPath, path.join(tempDir, 'page')])
      proc.on('error', reject)
      proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pdftoppm exited ${code}`))))
    })

    const files = fs
      .readdirSync(tempDir)
      .filter((f) => f.endsWith('.png'))
      .sort()
      .slice(0, maxPages)

    if (!files.length) return []

    const results = []
    for (let idx = 0; idx < files.length; idx += 1) {
      const file = path.join(tempDir, files[idx])
      const base64 = fs.readFileSync(file).toString('base64')
      const system = 'You are a precise extractor that outputs strict JSON.'
      const user = `Extract every assignment mentioned in this page image (${path.basename(pdfPath)} page ${idx + 1}). Respond ONLY with a JSON array.`
      const partial = await callAnthropicJSON(apiKey, {
        model: 'claude-3-5-sonnet-latest',
        max_tokens: 2500,
        temperature: 0,
        system,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: user },
              {
                type: 'input_image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: base64,
                },
              },
            ],
          },
        ],
      })
      results.push(...partial)
    }

    return dedupeAssignments(results).map(normalizeAssignment)
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch (err) {
      console.warn('Failed to clean temp vision dir', err?.message || err)
    }
  }
}

// Import assignments via Anthropic (proxy)
app.post('/api/extraction/import', upload.single('file'), async (req, res) => {
  try {
    let name, type, data
    if (req.file) {
      name = req.file.originalname
      type = req.file.mimetype || 'application/octet-stream'
      data = req.file.buffer.toString('base64')
    } else {
      const body = req.body || {}
      name = body.name
      type = body.type
      data = body.data
    }
    if (!name || !type || !data) return res.status(400).json({ error: 'No file provided' })
    const buffer = Buffer.from(data, 'base64')
    const lowerName = name.toLowerCase()
    const isPdf = type === 'application/pdf' || lowerName.endsWith('.pdf')
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return res.status(500).json({ error: 'Server missing ANTHROPIC_API_KEY' })
    if (isPdf) {
      let assignments = []
      try {
        assignments = await extractAssignmentsFromPdf(buffer, name, apiKey)
      } catch (err) {
        console.warn('PDF text extraction failed, falling back to vision:', err?.message || err)
      }
      if (!assignments.length) {
        try {
          const pdfPath = path.join('uploads', `import_${Date.now()}.pdf`)
          fs.writeFileSync(pdfPath, buffer)
          assignments = await extractAssignmentsFromImages(pdfPath, apiKey)
          try { fs.unlinkSync(pdfPath) } catch {}
        } catch (visionErr) {
          console.warn('PDF vision fallback failed:', visionErr?.message || visionErr)
        }
      }
      return res.json(assignments)
    }

    const system = [
      'You are a precise extractor that outputs strict JSON.',
      'Extract all assignments found in the attached document. Return ONLY a JSON array of objects.',
      'Each object must have: "title" (string), "courseName" (string), "dueDate" (ISO string or null),',
      '"description" (string), "pointsPossible" (number), "status" (one of: unsubmitted, submitted, graded, missing).',
      'If dates are ambiguous, infer the most likely and format as ISO 8601 in UTC.',
      'If any field is missing, provide a reasonable default (e.g., "Unknown Course", 0, "unsubmitted").',
      'Respond with JSON only, no extra text.'
    ].join(' ')

    const userText = 'Extract assignments from the attached document and return strict JSON only.'

    const body = {
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 2000,
      system,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            {
              type: 'document',
              source: { type: 'base64', media_type: type, data },
              title: name,
            },
          ],
        },
      ],
    }

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      const text = await resp.text()
      return res.status(502).json({ error: 'Anthropic request failed', status: resp.status, details: text })
    }
    const json = await resp.json()
    const content = json?.content?.[0]?.text || ''
    let parsed
    try { parsed = JSON.parse(content) } catch (e) {
      return res.status(500).json({ error: 'Failed to parse Anthropic JSON', raw: content?.slice?.(0, 500) })
    }
    if (!Array.isArray(parsed)) return res.status(500).json({ error: 'Anthropic did not return an array', raw: parsed })
    const normalized = dedupeAssignments(parsed).map(normalizeAssignment)
    res.json(normalized)
  } catch (err) {
    console.error('Import error', err)
    res.status(500).json({ error: 'Import failed', details: String(err) })
  }
})

const port = process.env.PORT || 8000
app.listen(port, () => {
  console.log(`Auth/File API listening on http://localhost:${port}`)
})
