import { describe, expect, it } from 'vitest'
import { SearchProfileService, type SearchProfile } from './search-profile-service.js'

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
