/**
 * fetchJson tries a real network request first. If it fails (network error)
 * or returns 404 in development, it falls back to mockFetch implemented in mocks/mock.ts.
 */
import { mockFetch } from '@/mocks/mock'

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const url = typeof input === 'string' ? input : (input as URL).toString()
  const method = (init?.method || 'GET').toUpperCase()
  if (import.meta.env.DEV && method !== 'GET') {
    console.debug('[fetchJson] request', method, url, { body: init?.body })
  }
  try {
    const res = await fetch(input, init)
    if (import.meta.env.DEV && method !== 'GET') {
      console.debug('[fetchJson] response', method, url, res.status)
    }
    if (!res.ok) {
      // Fallback to mock only for GET 404/0 in dev
      if (method === 'GET' && import.meta.env.DEV && (res.status === 404 || res.status === 0)) {
        const mock = await mockFetch(url, init)
        return await mock.json()
      }
      const text = await res.text()
      throw new Error(`HTTP ${res.status}: ${text}`)
    }
    return (await res.json()) as T
  } catch (err) {
    if (import.meta.env.DEV && method !== 'GET') {
      console.error('[fetchJson] error', method, url, err)
    }
    if (method === 'GET' && import.meta.env.DEV) {
      // Network errors also fallback to mock
      const mock = await mockFetch(url, init)
      return await mock.json()
    }
    throw err
  }
}

export const API_BASE = '/api'
