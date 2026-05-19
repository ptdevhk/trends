import { describe, expect, it } from 'vitest'

import {
  JOB51_SAFE_LAUNCH_LIMIT,
  JOB51_SAFE_LAUNCH_MAX_PAGES,
  SEARCH_PROFILE_SOURCE_TYPES,
  SEEK_MODE,
  buildCollectionLaunchUrl,
  buildJob51CollectUrl,
  buildJob5156CollectUrl,
  buildSeekCollectUrl,
  getActiveSearchProfileSource,
  getSearchProfileCollectionSource,
  getSearchProfileCollectUrl,
  resolveCollectionSource,
  resolveSeekMode,
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

  it('returns the active launchable collection source for Job5156 profiles', () => {
    const collectionSource = getSearchProfileCollectionSource([
      { type: 'manual_upload', enabled: true, priority: 1 },
      { type: SEARCH_PROFILE_SOURCE_TYPES.job5156, enabled: true, priority: 2 },
    ])

    expect(collectionSource).toEqual({
      type: SEARCH_PROFILE_SOURCE_TYPES.job5156,
    })
  })

  it('returns the active launchable collection source for 51job profiles', () => {
    const collectionSource = getSearchProfileCollectionSource([
      { type: 'manual_upload', enabled: true, priority: 1 },
      { type: SEARCH_PROFILE_SOURCE_TYPES.job51, enabled: true, priority: 2 },
    ])

    expect(collectionSource).toEqual({
      type: SEARCH_PROFILE_SOURCE_TYPES.job51,
    })
  })

  it('passes job51CollectLimit and job51MaxPages through getSearchProfileCollectionSource', () => {
    const collectionSource = getSearchProfileCollectionSource([
      { type: SEARCH_PROFILE_SOURCE_TYPES.job51, enabled: true, priority: 1, job51CollectLimit: 100, job51MaxPages: 3 },
    ])

    expect(collectionSource).toEqual({
      type: SEARCH_PROFILE_SOURCE_TYPES.job51,
      job51CollectLimit: 100,
      job51MaxPages: 3,
    })
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

  it('builds a generic Seek collect URL that preserves spaced locations', () => {
    const collectUrl = buildSeekCollectUrl({
      location: 'Kuala Lumpur MY',
      keywords: ['Sales Engineer', 'Sales Manager'],
    })

    expect(collectUrl).not.toBeNull()

    const url = new URL(collectUrl as string)
    expect(url.searchParams.get('location')).toBe('Kuala Lumpur MY')
    expect(url.searchParams.get('keyword')).toBe('"Sales Engineer" OR "Sales Manager"')
    expect(url.searchParams.get('tr_auto_sync')).toBe('true')
  })

  it('builds a Job5156 collect URL with Trends control params', () => {
    const collectUrl = buildJob5156CollectUrl({
      location: '东莞,深圳',
      keywords: ['CNC', '销售'],
      collectLimit: 50,
      maxPages: 4,
      minAge: 28,
      maxAge: 40,
    })

    expect(collectUrl).not.toBeNull()
    const url = new URL(collectUrl as string)
    expect(`${url.origin}${url.pathname}`).toBe('https://hr.job5156.com/search')
    expect(url.searchParams.get('keyword')).toBe('CNC 销售')
    expect(url.searchParams.get('location')).toBe('东莞,深圳')
    expect(url.searchParams.get('tr_auto_sync')).toBe('true')
    expect(url.searchParams.get('tr_limit')).toBe('50')
    expect(url.searchParams.get('tr_max_pages')).toBe('4')
    expect(url.searchParams.get('tr_min_age')).toBe('28')
    expect(url.searchParams.get('tr_max_age')).toBe('40')
  })

  it('omits the Job5156 location parameter for China-wide searches', () => {
    const collectUrl = buildJob5156CollectUrl({
      location: 'China',
      keywords: ['CNC', '销售'],
      maxPages: 2,
    })

    expect(collectUrl).not.toBeNull()
    const url = new URL(collectUrl as string)
    expect(url.searchParams.get('location')).toBeNull()
    expect(url.searchParams.get('keyword')).toBe('CNC 销售')
  })

  it('caps 51job launch URLs to conservative single-page limits', () => {
    const collectUrl = buildJob51CollectUrl({
      location: '东莞',
      keywords: ['CNC', '销售'],
      collectLimit: 120,
      maxPages: 10,
      minAge: 25,
      maxAge: 40,
    })

    expect(collectUrl).not.toBeNull()
    const url = new URL(collectUrl as string)
    expect(`${url.origin}${url.pathname}`).toBe('https://ehire.51job.com/Revision/talent/search')
    expect(url.searchParams.get('keyword')).toBe('CNC 销售')
    expect(url.searchParams.get('location')).toBe('东莞')
    expect(url.searchParams.get('tr_limit')).toBe(String(JOB51_SAFE_LAUNCH_LIMIT))
    expect(url.searchParams.get('tr_max_pages')).toBe(String(JOB51_SAFE_LAUNCH_MAX_PAGES))
    expect(url.searchParams.get('tr_min_age')).toBe('25')
    expect(url.searchParams.get('tr_max_age')).toBe('40')
  })

  it('allows larger 51job launch URLs when unsafe limits are explicitly enabled', () => {
    const collectUrl = buildJob51CollectUrl({
      location: '东莞',
      keywords: ['CNC', '销售'],
      collectLimit: 250,
      maxPages: 8,
      minAge: 25,
      maxAge: 40,
      unsafeLimits: true,
    })

    expect(collectUrl).not.toBeNull()
    const url = new URL(collectUrl as string)
    expect(url.searchParams.get('tr_limit')).toBe('250')
    expect(url.searchParams.get('tr_max_pages')).toBe('8')
    expect(url.searchParams.get('tr_unsafe_limits')).toBe('1')
    expect(url.searchParams.get('tr_min_age')).toBe('25')
    expect(url.searchParams.get('tr_max_age')).toBe('40')
  })

  it('uses source-level job51CollectLimit overriding generic collectLimit', () => {
    const collectUrl = buildJob51CollectUrl({
      location: '东莞',
      keywords: ['CNC'],
      collectLimit: 50,
      job51CollectLimit: 100,
      job51MaxPages: 3,
    })

    expect(collectUrl).not.toBeNull()
    const url = new URL(collectUrl as string)
    expect(url.searchParams.get('tr_limit')).toBe('100')
    expect(url.searchParams.get('tr_max_pages')).toBe('3')
    expect(url.searchParams.get('tr_unsafe_limits')).toBe('1')
  })

  it('auto-derives unsafeLimits when source-level limit exceeds safe threshold', () => {
    const collectUrl = buildJob51CollectUrl({
      location: '东莞',
      keywords: ['CNC'],
      job51CollectLimit: 200,
    })

    expect(collectUrl).not.toBeNull()
    const url = new URL(collectUrl as string)
    expect(url.searchParams.get('tr_limit')).toBe('200')
    expect(url.searchParams.get('tr_max_pages')).toBe('1')
    expect(url.searchParams.get('tr_unsafe_limits')).toBe('1')
  })

  it('auto-derives unsafeLimits when source-level maxPages exceeds safe threshold', () => {
    const collectUrl = buildJob51CollectUrl({
      location: '东莞',
      keywords: ['CNC'],
      job51MaxPages: 5,
    })

    expect(collectUrl).not.toBeNull()
    const url = new URL(collectUrl as string)
    expect(url.searchParams.get('tr_limit')).toBe('50')
    expect(url.searchParams.get('tr_max_pages')).toBe('5')
    expect(url.searchParams.get('tr_unsafe_limits')).toBe('1')
  })

  it('keeps safe defaults when source-level values are at or below threshold', () => {
    const collectUrl = buildJob51CollectUrl({
      location: '东莞',
      keywords: ['CNC'],
      job51CollectLimit: 50,
      job51MaxPages: 1,
    })

    expect(collectUrl).not.toBeNull()
    const url = new URL(collectUrl as string)
    expect(url.searchParams.get('tr_limit')).toBe('50')
    expect(url.searchParams.get('tr_max_pages')).toBe('1')
    expect(url.searchParams.get('tr_unsafe_limits')).toBeNull()
  })

  it('passes source-level limits through buildCollectionLaunchUrl', () => {
    const job51Url = buildCollectionLaunchUrl({
      source: {
        type: SEARCH_PROFILE_SOURCE_TYPES.job51,
        job51CollectLimit: 150,
        job51MaxPages: 4,
      },
      location: '东莞',
      keywords: ['CNC'],
    })

    expect(job51Url).not.toBeNull()
    const url = new URL(job51Url as string)
    expect(url.searchParams.get('tr_limit')).toBe('150')
    expect(url.searchParams.get('tr_max_pages')).toBe('4')
    expect(url.searchParams.get('tr_unsafe_limits')).toBe('1')
  })

  it('returns undefined when no structured collection source exists', () => {
    expect(resolveCollectionSource(undefined)).toBeUndefined()
  })

  it('builds launch URLs from an explicit collection source', () => {
    const seekUrl = buildCollectionLaunchUrl({
      source: {
        type: SEARCH_PROFILE_SOURCE_TYPES.seek,
        exactUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=90842915&pageNumber=1',
      },
      location: 'Kuala Lumpur MY',
      keywords: ['Sales Engineer'],
      maxPages: 2,
    })
    const job5156Url = buildCollectionLaunchUrl({
      source: {
        type: SEARCH_PROFILE_SOURCE_TYPES.job5156,
      },
      location: '东莞',
      keywords: ['CNC'],
      maxPages: 2,
    })
    const job51Url = buildCollectionLaunchUrl({
      source: {
        type: SEARCH_PROFILE_SOURCE_TYPES.job51,
      },
      location: '东莞',
      keywords: ['CNC'],
      maxPages: 2,
    })

    expect(seekUrl).toContain('jobId=90842915')
    expect(seekUrl).toContain('tr_max_pages=2')
    expect(job5156Url).toContain('hr.job5156.com/search')
    expect(job5156Url).toContain('tr_max_pages=2')
    expect(job51Url).toContain('ehire.51job.com/Revision/talent/search')
    expect(job51Url).toContain('tr_max_pages=1')
  })
})

describe('seek mode', () => {
  it('resolveSeekMode returns "recommended" when mode is undefined (back-compat default)', () => {
    expect(resolveSeekMode(undefined)).toBe('recommended')
  })

  it('resolveSeekMode returns "talentsearch" when explicitly set', () => {
    expect(resolveSeekMode('talentsearch')).toBe('talentsearch')
  })

  it('resolveSeekMode rejects unknown values and falls back to "recommended"', () => {
    expect(resolveSeekMode('garbage' as unknown as 'recommended')).toBe('recommended')
  })

  it('SEEK_MODE constant exposes both values', () => {
    expect(SEEK_MODE.recommended).toBe('recommended')
    expect(SEEK_MODE.talentsearch).toBe('talentsearch')
  })
})
