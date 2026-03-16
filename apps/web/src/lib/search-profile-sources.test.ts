import { describe, expect, it } from 'vitest'

import {
  SEARCH_PROFILE_SOURCE_TYPES,
  buildSeekCollectUrl,
  getActiveSearchProfileSource,
  getSearchProfileCollectUrl,
} from './search-profile-sources'

describe('search-profile-sources', () => {
  it('preserves exact Seek job URLs while replacing Trends control params', () => {
    const collectUrl = buildSeekCollectUrl({
      baseUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=90842915&pageNumber=1&tr_limit=5&tr_auto_sync=false',
      location: 'Kuala Lumpur MY',
      keywords: ['Sales Engineer'],
      collectLimit: 120,
      maxPages: 3,
      minAge: 25,
      maxAge: 40,
    })

    expect(collectUrl).not.toBeNull()
    const url = new URL(collectUrl as string)
    expect(`${url.origin}${url.pathname}`).toBe('https://my.employer.seek.com/candidates/recommended')
    expect(url.searchParams.get('jobId')).toBe('90842915')
    expect(url.searchParams.get('pageNumber')).toBe('1')
    expect(url.searchParams.get('keyword')).toBeNull()
    expect(url.searchParams.get('tr_auto_sync')).toBe('true')
    expect(url.searchParams.get('tr_limit')).toBe('120')
    expect(url.searchParams.get('tr_max_pages')).toBe('3')
    expect(url.searchParams.get('tr_min_age')).toBe('25')
    expect(url.searchParams.get('tr_max_age')).toBe('40')
  })

  it('returns the preferred enabled Seek collect URL even when another source has higher priority', () => {
    const collectUrl = getSearchProfileCollectUrl([
      { type: SEARCH_PROFILE_SOURCE_TYPES.job5156, enabled: true, priority: 1 },
      {
        type: SEARCH_PROFILE_SOURCE_TYPES.seek,
        enabled: true,
        priority: 2,
        jobUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=90842915&pageNumber=1',
      },
    ])

    expect(collectUrl).toBe('https://my.employer.seek.com/candidates/recommended?jobId=90842915&pageNumber=1')
  })

  it('uses enabled priority order when selecting the active source', () => {
    const activeSource = getActiveSearchProfileSource([
      { type: SEARCH_PROFILE_SOURCE_TYPES.seek, enabled: true, priority: 2 },
      { type: SEARCH_PROFILE_SOURCE_TYPES.job5156, enabled: true, priority: 1 },
    ])

    expect(activeSource).toEqual({
      type: SEARCH_PROFILE_SOURCE_TYPES.job5156,
      enabled: true,
      priority: 1,
    })
  })
})
