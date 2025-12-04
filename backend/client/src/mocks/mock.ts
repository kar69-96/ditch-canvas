// Simple markdown-based mock layer that responds to /api calls in dev

type MockMap = Record<string, any>

let cache: { map: MockMap | null; loaded: boolean } = { map: null, loaded: false }

async function loadSampleMap(): Promise<MockMap> {
  if (cache.loaded && cache.map) return cache.map
  try {
    const md = await fetch('/sample-data.md').then((r) => r.text())
    const map = parseSampleMarkdown(md)
    cache = { map, loaded: true }
    return map
  } catch {
    cache = { map: {}, loaded: true }
    return {}
  }
}

// Parses sections like:
// ### GET /api/extraction/assignments
// ```json
// { ... ApiResponse<Assignment[]> }
// ```
export function parseSampleMarkdown(md: string): MockMap {
  const lines = md.split(/\r?\n/)
  const map: MockMap = {}
  let i = 0
  while (i < lines.length) {
    const header = lines[i].match(/^###\s+(GET|POST|PUT|PATCH|DELETE)\s+(.+)$/i)
    if (header) {
      const method = header[1].toUpperCase()
      const path = header[2].trim()
      // advance to first ```json fence
      i++
      while (i < lines.length && !/^```json/i.test(lines[i])) i++
      if (i >= lines.length) break
      i++
      const jsonLines: string[] = []
      while (i < lines.length && !/^```/.test(lines[i])) {
        jsonLines.push(lines[i])
        i++
      }
      const key = `${method} ${path}`
      try {
        map[key] = JSON.parse(jsonLines.join('\n'))
      } catch {
        // ignore invalid blocks
      }
    }
    i++
  }
  return map
}

export async function mockFetch(input: RequestInfo | string, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : (input as Request).url
  const u = new URL(url, window.location.origin)
  const method = (init?.method || 'GET').toUpperCase()
  const key = `${method} ${u.pathname}`
  const map = await loadSampleMap()
  if (map[key]) {
    const body = JSON.stringify(map[key])
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return new Response(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Mock not found', statusCode: 404 } }), { status: 404 })
}

export function enableMockFetch() {
  if (!import.meta.env.DEV) return
  const original = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const res = await original(input as any, init)
      if (!res.ok && (res.status === 404 || res.status === 0)) {
        return mockFetch(input as any, init)
      }
      return res
    } catch {
      return mockFetch(input as any, init)
    }
  }
}
