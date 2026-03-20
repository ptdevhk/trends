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
