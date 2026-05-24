import { describe, expect, it } from 'vitest'
import {
  SearchProfileService,
  matchSearchProfilesByKeywords,
  type SearchProfile,
} from './search-profile-service.js'

describe('SearchProfileService explicit clear semantics', () => {
  it('clears optional linkage fields when null is provided in an update payload', () => {
    const service = new SearchProfileService()
    const existingProfile: SearchProfile = {
      id: 'custom-profile-1',
      name: 'CNC销售-Demo',
      status: 'active',
      location: '广东',
      keywords: ['销售', 'CNC'],
      jobDescription: 'js7bbr2wheavb7krrycbz2gvn182d88y',
      filterPreset: 'machinery-sales',
      filters: {
        minExperience: 1,
        maxAge: 40,
      },
      schedule: {
        enabled: true,
        cron: '0 9 * * 1-5',
      },
    }

    const normalized = service.normalizeProfileInput(
      {
        jobDescription: null,
        filterPreset: null,
        filters: null,
      },
      existingProfile,
    )

    expect(normalized.location).toBe('广东')
    expect(normalized.keywords).toEqual(['销售', 'CNC'])
    expect(normalized.jobDescription).toBeUndefined()
    expect(normalized.filterPreset).toBeUndefined()
    expect(normalized.filters).toBeUndefined()
    expect(normalized.schedule).toEqual({
      enabled: true,
      cron: '0 9 * * 1-5',
    })
  })

  it('preserves an explicit empty location instead of restoring the previous one', () => {
    const service = new SearchProfileService()
    const existingProfile: SearchProfile = {
      id: 'custom-profile-1',
      name: 'CNC销售-Demo',
      status: 'active',
      location: '广东,江苏',
      keywords: ['销售', 'CNC'],
    }

    const normalized = service.normalizeProfileInput(
      {
        location: '',
      },
      existingProfile,
    )

    expect(normalized.location).toBe('')
    expect(() => service.validateProfile(normalized)).not.toThrow()
  })
})

describe('SearchProfileService keyword normalization', () => {
  it('deduplicates mixed-case keywords and required keywords while preserving the first label', () => {
    const service = new SearchProfileService()

    const normalized = service.normalizeProfileInput({
      id: 'custom-profile-2',
      name: 'CNC销售-MixedCase',
      status: 'active',
      location: '广东',
      keywords: ['CNC', 'cnc', ' 销售 ', '销售'],
      requiredKeywords: ['CNC', 'cnc', ' 销售 ', '销售'],
    })

    expect(normalized.keywords).toEqual(['CNC', '销售'])
    expect(normalized.requiredKeywords).toEqual(['CNC', '销售'])
  })

  it('matches profiles regardless of input keyword case', () => {
    const profile: SearchProfile = {
      id: 'custom-profile-3',
      name: 'CNC销售-Profile',
      status: 'active',
      location: '广东',
      keywords: ['CNC', '销售'],
    }

    const lowerCaseMatch = matchSearchProfilesByKeywords([profile], ['cnc'])
    const upperCaseMatch = matchSearchProfilesByKeywords([profile], ['CNC'])

    expect(lowerCaseMatch.profile?.id).toBe(profile.id)
    expect(lowerCaseMatch.matchedKeywords).toEqual(['cnc'])
    expect(lowerCaseMatch.confidence).toBeGreaterThan(0.3)
    expect(upperCaseMatch.profile?.id).toBe(profile.id)
    expect(upperCaseMatch.matchedKeywords).toEqual(['cnc'])
    expect(upperCaseMatch.confidence).toBeGreaterThan(0.3)
  })
})

describe('SearchProfileService seek source validation', () => {
  it('rejects enabled seek source with mode/URL mismatch', () => {
    const svc = new SearchProfileService()
    expect(() =>
      svc.validateProfile({
        id: 'test-mismatch',
        name: 'Test',
        status: 'active',
        location: 'MY',
        keywords: ['x'],
        sources: [{
          type: 'seek',
          enabled: true,
          priority: 1,
          mode: 'recommended',
          jobUrl: 'https://hk.employer.seek.com/talentsearch?keywords=x',
        }],
      } as SearchProfile)
    ).toThrow(/mode|recommended|talentsearch/i)
  })

  it('accepts enabled seek source with mode=talentsearch and matching URL', () => {
    const svc = new SearchProfileService()
    expect(() =>
      svc.validateProfile({
        id: 'test-ts',
        name: 'Test',
        status: 'active',
        location: 'MY',
        keywords: ['x'],
        sources: [{
          type: 'seek',
          enabled: true,
          priority: 1,
          mode: 'talentsearch',
          jobUrl: 'https://hk.employer.seek.com/talentsearch?keywords=x',
        }],
      } as SearchProfile)
    ).not.toThrow()
  })
})

describe('matchSearchProfilesByKeywords', () => {
  const profiles: SearchProfile[] = [
    {
      id: 'cnc-sales',
      name: 'CNC销售',
      status: 'active',
      location: '东莞',
      keywords: ['CNC', '销售', '机床'],
    },
    {
      id: 'software-dev',
      name: '软件开发',
      status: 'active',
      location: '深圳',
      keywords: ['Java', 'Python', '全栈'],
    },
    {
      id: 'paused-profile',
      name: '已暂停',
      status: 'paused',
      location: '广州',
      keywords: ['CNC', '销售'],
    },
  ]

  it('returns confidence 0 when input keywords are empty', () => {
    const result = matchSearchProfilesByKeywords(profiles, [])
    expect(result.confidence).toBe(0)
    expect(result.matchedKeywords).toEqual([])
    expect(result.profile).toBeUndefined()
  })

  it('matches the best profile by keyword overlap', () => {
    const result = matchSearchProfilesByKeywords(profiles, ['CNC', '销售'])
    expect(result.profile?.id).toBe('cnc-sales')
    expect(result.confidence).toBeGreaterThan(0.3)
    expect(result.matchedKeywords).toEqual(expect.arrayContaining(['cnc', '销售']))
  })

  it('skips paused/archived profiles', () => {
    const result = matchSearchProfilesByKeywords(profiles, ['CNC'])
    // paused-profile has same keywords but should be skipped
    expect(result.profile?.id).toBe('cnc-sales')
  })

  it('returns confidence 0 when no profile exceeds the 0.3 threshold', () => {
    const result = matchSearchProfilesByKeywords(profiles, ['完全无关的关键词'])
    expect(result.confidence).toBe(0)
    expect(result.profile).toBeUndefined()
  })

  it('adds location bonus when location matches', () => {
    // Use partial keyword overlap so score < 1.0, allowing the +0.2 bonus to be visible
    const withLocation = matchSearchProfilesByKeywords(profiles, ['CNC', '无关词'], '东莞')
    const withoutLocation = matchSearchProfilesByKeywords(profiles, ['CNC', '无关词'])
    expect(withLocation.confidence).toBeGreaterThan(withoutLocation.confidence)
  })

  it('does not add location bonus when location does not match', () => {
    const withLocation = matchSearchProfilesByKeywords(profiles, ['CNC', '无关词'], '深圳')
    const withoutLocation = matchSearchProfilesByKeywords(profiles, ['CNC', '无关词'])
    expect(withLocation.confidence).toBe(withoutLocation.confidence)
  })

  it('caps confidence at 1.0 even with high keyword overlap + location bonus', () => {
    const result = matchSearchProfilesByKeywords(
      [{ id: 'p1', name: 'Test', status: 'active', keywords: ['a', 'b', 'c'] }],
      ['a', 'b', 'c'],
      'any',
    )
    expect(result.confidence).toBeLessThanOrEqual(1)
  })

  it('handles substring keyword matching (input contains profile keyword)', () => {
    const localProfiles: SearchProfile[] = [
      { id: 'p1', name: 'Test', status: 'active', keywords: ['CNC'] },
    ]
    const result = matchSearchProfilesByKeywords(localProfiles, ['CNC机床'])
    expect(result.profile?.id).toBe('p1')
    expect(result.confidence).toBeGreaterThan(0.3)
  })

  it('handles substring keyword matching (profile keyword contains input)', () => {
    const localProfiles: SearchProfile[] = [
      { id: 'p1', name: 'Test', status: 'active', keywords: ['CNC机床'] },
    ]
    const result = matchSearchProfilesByKeywords(localProfiles, ['CNC'])
    expect(result.profile?.id).toBe('p1')
    expect(result.confidence).toBeGreaterThan(0.3)
  })

  it('returns jobDescription and filterPreset from matched profile', () => {
    const localProfiles: SearchProfile[] = [
      {
        id: 'p1',
        name: 'Test',
        status: 'active',
        keywords: ['CNC'],
        jobDescription: 'jd-abc123',
        filterPreset: 'machinery-sales',
      },
    ]
    const result = matchSearchProfilesByKeywords(localProfiles, ['CNC'])
    expect(result.jobDescription).toBe('jd-abc123')
    expect(result.filterPreset).toBe('machinery-sales')
  })
})
