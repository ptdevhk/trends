import { describe, expect, it } from 'vitest'
import {
  emptyUnresolvedQueueView,
  isUnresolvedQueueStatus,
  parseUnresolvedQueueItem,
  parseUnresolvedQueueStatus,
  parseUnresolvedQueueView,
} from './unresolved-queue-model'

const unresolvedItem = {
  normalizedKey: 'unknownoema',
  count: 2,
  examples: ['UnknownOEM-A', 'UnknownOEM A'],
  maxNearbyScore: 80,
  reasons: ['miss'],
  priority: true,
  priorityReasons: ['score>=70'],
}

const linkedItem = {
  normalizedKey: 'freqbrandx',
  count: 3,
  examples: ['FreqBrandX'],
  maxNearbyScore: 10,
  reasons: ['miss'],
  priority: true,
  priorityReasons: ['freq>=3'],
  resolution: {
    action: 'link',
    targetCompanyKey: 'polywell',
    resolvedAt: '2026-08-19T00:00:00.000Z',
    resolvedBy: 'admin-user',
  },
}

const ignoredItem = {
  normalizedKey: 'otherb',
  count: 1,
  examples: ['Other-B'],
  maxNearbyScore: 10,
  reasons: ['low_confidence_keyword'],
  priority: false,
  priorityReasons: [],
  resolution: {
    action: 'ignore',
    resolvedAt: '2026-08-19T01:00:00.000Z',
    resolvedBy: 'admin-user',
  },
}

describe('parseUnresolvedQueueItem', () => {
  it('parses an unresolved item without a resolution', () => {
    const item = parseUnresolvedQueueItem(unresolvedItem)
    expect(item).not.toBeNull()
    expect(item).toMatchObject({
      normalizedKey: 'unknownoema',
      count: 2,
      examples: ['UnknownOEM-A', 'UnknownOEM A'],
      maxNearbyScore: 80,
      reasons: ['miss'],
      priority: true,
      priorityReasons: ['score>=70'],
    })
    expect(item?.resolution).toBeUndefined()
  })

  it('parses a linked item with a target company key', () => {
    const item = parseUnresolvedQueueItem(linkedItem)
    expect(item).not.toBeNull()
    expect(item?.resolution).toMatchObject({
      action: 'link',
      targetCompanyKey: 'polywell',
      resolvedBy: 'admin-user',
    })
  })

  it('parses an ignored item without a target company key', () => {
    const item = parseUnresolvedQueueItem(ignoredItem)
    expect(item).not.toBeNull()
    expect(item?.resolution).toMatchObject({ action: 'ignore' })
    expect(item?.resolution?.targetCompanyKey).toBeUndefined()
  })

  it('rejects items without a normalizedKey', () => {
    expect(parseUnresolvedQueueItem({ count: 1, examples: [] })).toBeNull()
    expect(parseUnresolvedQueueItem(null)).toBeNull()
    expect(parseUnresolvedQueueItem('nope')).toBeNull()
  })

  it('defaults missing numerics to 0 and filters non-string examples', () => {
    const item = parseUnresolvedQueueItem({
      normalizedKey: 'odd',
      count: 'three',
      examples: ['ok', 42, null],
      reasons: [1, 'miss'],
    })
    expect(item).toMatchObject({ normalizedKey: 'odd', count: 0, maxNearbyScore: 0, examples: ['ok'], reasons: ['miss'], priority: false })
  })

  it('drops a malformed resolution but keeps the item', () => {
    const item = parseUnresolvedQueueItem({
      ...unresolvedItem,
      resolution: { action: 'bogus' },
    })
    expect(item).not.toBeNull()
    expect(item?.resolution).toBeUndefined()
  })

  it('keeps an ignore resolution that lacks resolvedAt/resolvedBy', () => {
    const item = parseUnresolvedQueueItem({
      ...unresolvedItem,
      resolution: { action: 'ignore' },
    })
    expect(item?.resolution).toEqual({ action: 'ignore' })
  })
})

describe('parseUnresolvedQueueView', () => {
  it('parses a full response with items, total, and counts', () => {
    const view = parseUnresolvedQueueView({
      success: true,
      items: [unresolvedItem, linkedItem, ignoredItem],
      total: 3,
      counts: { unresolved: 1, linked: 1, ignored: 1, total: 3 },
    })
    expect(view.items).toHaveLength(3)
    expect(view.total).toBe(3)
    expect(view.counts).toEqual({ unresolved: 1, linked: 1, ignored: 1, total: 3 })
    expect(view.items[1].resolution?.action).toBe('link')
  })

  it('drops malformed items while keeping valid ones', () => {
    const view = parseUnresolvedQueueView({
      items: [unresolvedItem, { count: 1 }, ignoredItem],
      total: 2,
      counts: { unresolved: 1, linked: 0, ignored: 1, total: 2 },
    })
    expect(view.items).toHaveLength(2)
    expect(view.items.map((i) => i.normalizedKey)).toEqual(['unknownoema', 'otherb'])
  })

  it('returns an empty view for a non-record payload', () => {
    expect(parseUnresolvedQueueView(null)).toEqual(emptyUnresolvedQueueView())
    expect(parseUnresolvedQueueView({})).toEqual(emptyUnresolvedQueueView())
    expect(parseUnresolvedQueueView({ items: 'x' })).toEqual(emptyUnresolvedQueueView())
  })

  it('defaults missing counts to zeros', () => {
    const view = parseUnresolvedQueueView({ items: [], total: 0 })
    expect(view.counts).toEqual({ unresolved: 0, linked: 0, ignored: 0, total: 0 })
  })

  it('coerces string counts defensively', () => {
    const view = parseUnresolvedQueueView({
      items: [],
      total: '0',
      counts: { unresolved: '1', linked: 0, ignored: 0, total: '1' },
    })
    expect(view.total).toBe(0)
    expect(view.counts.unresolved).toBe(1)
  })
})

describe('parseUnresolvedQueueStatus / isUnresolvedQueueStatus', () => {
  it('accepts the four status values', () => {
    for (const status of ['unresolved', 'linked', 'ignored', 'all'] as const) {
      expect(isUnresolvedQueueStatus(status)).toBe(true)
      expect(parseUnresolvedQueueStatus(status)).toBe(status)
    }
  })

  it('defaults unknown and empty values to unresolved', () => {
    expect(isUnresolvedQueueStatus('bogus')).toBe(false)
    expect(parseUnresolvedQueueStatus('bogus')).toBe('unresolved')
    expect(parseUnresolvedQueueStatus(null)).toBe('unresolved')
    expect(parseUnresolvedQueueStatus(undefined)).toBe('unresolved')
  })
})
