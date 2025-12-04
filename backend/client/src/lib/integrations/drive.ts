import type { Assignment } from '@/types/api'
import type { FileKind, FileLink, Provider } from '@/types/integrations'

function sanitizeFolder(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '').trim() || 'Course'
}

function randomId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

export async function createFile(a: Assignment, provider: Provider, kind: FileKind): Promise<FileLink> {
  const folder = sanitizeFolder(a.courseName)
  const id = randomId(provider === 'google' ? 'g' : 'm')
  const ext = kind === 'doc' ? (provider === 'google' ? 'document' : 'word')
    : kind === 'sheet' ? (provider === 'google' ? 'spreadsheets' : 'excel')
    : (provider === 'google' ? 'presentation' : 'powerpoint')

  const base = provider === 'google'
    ? `https://docs.google.com/${ext}/d/${id}`
    : `https://onedrive.live.com/edit.aspx?resid=${id}`

  return {
    id,
    provider,
    kind,
    name: `${a.title}`,
    url: base,
    folder,
    createdAt: new Date().toISOString(),
  }
}

