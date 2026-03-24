import { describe, expect, it } from 'vitest'

import { normalizeIndustryTags } from '@trends/shared'

describe('job description industry tag normalization', () => {
  it('strips non-canonical industry tags like cnc and automation', () => {
    const raw = ['machinery', 'cnc', 'automation', 'sales']
    const normalized = normalizeIndustryTags(raw)

    expect(normalized).toEqual(['machinery', 'sales'])
  })

  it('returns empty array for undefined input', () => {
    expect(normalizeIndustryTags(undefined)).toEqual([])
  })

  it('preserves already-canonical tags', () => {
    const tags = ['machinery', 'sales']
    expect(normalizeIndustryTags(tags)).toEqual(['machinery', 'sales'])
  })
})
