import { isRecord } from '@trends/shared'
import type { paths } from '@/lib/api-types'

type UnresolvedQueueResponse =
  paths['/api/industry-data/unresolved']['get']['responses'][200]['content']['application/json']

export type UnresolvedQueueResolution = {
  action: 'link' | 'ignore'
  targetCompanyKey?: string
  resolvedAt?: string
  resolvedBy?: string
}

export type UnresolvedQueueItem = UnresolvedQueueResponse['items'][number] & {
  normalizedKey: string
  count: number
  examples: string[]
  maxNearbyScore: number
  reasons: string[]
  priority: boolean
  priorityReasons: string[]
  resolution?: UnresolvedQueueResolution
}

export type UnresolvedQueueCounts = {
  unresolved: number
  linked: number
  ignored: number
  total: number
}

export type UnresolvedQueueStatus = 'unresolved' | 'linked' | 'ignored' | 'all'

export type UnresolvedQueueView = {
  items: UnresolvedQueueItem[]
  total: number
  counts: UnresolvedQueueCounts
}

export const UNRESOLVED_QUEUE_STATUSES = [
  'unresolved',
  'linked',
  'ignored',
  'all',
] as const satisfies readonly UnresolvedQueueStatus[]

export function isUnresolvedQueueStatus(value: unknown): value is UnresolvedQueueStatus {
  return (UNRESOLVED_QUEUE_STATUSES as readonly unknown[]).includes(value)
}

export function parseUnresolvedQueueStatus(
  value: string | null | undefined,
): UnresolvedQueueStatus {
  if (value && isUnresolvedQueueStatus(value)) return value
  return 'unresolved'
}

function parseNonNegativeNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function parseResolution(value: unknown): UnresolvedQueueResolution | undefined {
  if (!isRecord(value)) return undefined
  if (value.action !== 'link' && value.action !== 'ignore') return undefined
  const resolution: UnresolvedQueueResolution = { action: value.action }
  if (typeof value.targetCompanyKey === 'string') {
    resolution.targetCompanyKey = value.targetCompanyKey
  }
  if (typeof value.resolvedAt === 'string') {
    resolution.resolvedAt = value.resolvedAt
  }
  if (typeof value.resolvedBy === 'string') {
    resolution.resolvedBy = value.resolvedBy
  }
  return resolution
}

/**
 * Parse one unresolved-queue item. The API types the items as `unknown[]`,
 * so every field is guarded; malformed items return null and are dropped by
 * the view parser.
 */
export function parseUnresolvedQueueItem(value: unknown): UnresolvedQueueItem | null {
  if (!isRecord(value)) return null
  if (typeof value.normalizedKey !== 'string' || !value.normalizedKey) return null
  const item: UnresolvedQueueItem = {
    normalizedKey: value.normalizedKey,
    count: parseNonNegativeNumber(value.count),
    examples: parseStringArray(value.examples),
    maxNearbyScore: parseNonNegativeNumber(value.maxNearbyScore),
    reasons: parseStringArray(value.reasons),
    priority: value.priority === true,
    priorityReasons: parseStringArray(value.priorityReasons),
  }
  const resolution = parseResolution(value.resolution)
  if (resolution) item.resolution = resolution
  return item
}

export function emptyUnresolvedQueueView(): UnresolvedQueueView {
  return {
    items: [],
    total: 0,
    counts: { unresolved: 0, linked: 0, ignored: 0, total: 0 },
  }
}

/** Parse a list response payload into validated queue items + counts. */
export function parseUnresolvedQueueView(value: unknown): UnresolvedQueueView {
  if (!isRecord(value) || !Array.isArray(value.items)) return emptyUnresolvedQueueView()
  const items: UnresolvedQueueItem[] = []
  for (const raw of value.items) {
    const item = parseUnresolvedQueueItem(raw)
    if (item) items.push(item)
  }
  return {
    items,
    total: parseNonNegativeNumber(value.total),
    counts: isRecord(value.counts)
      ? {
          unresolved: parseNonNegativeNumber(value.counts.unresolved),
          linked: parseNonNegativeNumber(value.counts.linked),
          ignored: parseNonNegativeNumber(value.counts.ignored),
          total: parseNonNegativeNumber(value.counts.total),
        }
      : { unresolved: 0, linked: 0, ignored: 0, total: 0 },
  }
}
