export type EntryType = 'company' | 'keyword' | 'brand' | 'url'
export type TabId = 'manage' | 'control' | 'audit'

export type IndustryDataEntry = {
  entryType: EntryType
  entryId: string
  data: unknown
  sortOrder?: number
  updatedBy?: string
}

export type AuditItem = {
  kind: 'data_edit' | 'maintenance'
  at: number
  companyKey?: string
  summary: string
  gitSha?: string | null
  runId?: string
  action?: string
  actor?: string
}

export type MaintenanceRun = {
  runId: string
  triggerSource?: string
  status?: string
  operatorSummary?: string
  startedAt?: number
}

export function formatTime(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function entryLabel(entry: IndustryDataEntry): string {
  const data = entry.data
  if (data && typeof data === 'object') {
    const rec = data as Record<string, unknown>
    if (typeof rec.nameCn === 'string') return rec.nameCn
    if (typeof rec.keyword === 'string') return rec.keyword
    if (typeof rec.url === 'string') return rec.url
  }
  if (typeof data === 'string') return data
  return entry.entryId
}
