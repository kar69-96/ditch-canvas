import type { FileLink, Provider, FileKind } from '@/types/integrations'

const KEY = 'assignment-work-links'

type Store = Record<string, FileLink[]> // assignmentId -> links

function load(): Store {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} as any }
}

function save(state: Store) { localStorage.setItem(KEY, JSON.stringify(state)) }

export function getLinks(assignmentId: string): FileLink[] {
  const s = load()
  return s[assignmentId] || []
}

export function addLink(assignmentId: string, link: FileLink) {
  const s = load()
  s[assignmentId] = [...(s[assignmentId] || []), link]
  save(s)
}

export function findLink(assignmentId: string, provider: Provider, kind: FileKind): FileLink | undefined {
  return getLinks(assignmentId).find(l => l.provider === provider && l.kind === kind)
}

