import type { Provider } from '@/types/integrations'

const KEY = 'sso-connections'

type SsoState = Record<Provider, { connected: boolean; connectedAt?: string }>

function load(): SsoState {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} as any }
}

function save(state: SsoState) {
  localStorage.setItem(KEY, JSON.stringify(state))
}

export function isConnected(provider: Provider): boolean {
  const s = load()
  return !!s[provider]?.connected
}

// Dev-only mock: toggles connection. Real app will redirect to SSO.
export async function connect(provider: Provider): Promise<void> {
  const s = load()
  s[provider] = { connected: true, connectedAt: new Date().toISOString() }
  save(s)
}

export async function disconnect(provider: Provider): Promise<void> {
  const s = load()
  s[provider] = { connected: false }
  save(s)
}

export function getStatus(): SsoState {
  return load()
}

