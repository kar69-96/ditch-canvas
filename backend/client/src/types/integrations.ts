export type Provider = 'google' | 'microsoft'

export type FileKind = 'doc' | 'sheet' | 'slide'

export interface FileLink {
  id: string
  provider: Provider
  kind: FileKind
  name: string
  url: string
  folder: string // course folder
  createdAt: string
}

