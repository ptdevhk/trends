import { describe, expect, it } from 'vitest'
import {
  SearchProfileService,
  matchSearchProfilesByKeywords,
  type SearchProfile,
} from './search-profile-service.js'

const svc = new SearchProfileService()

// ---------------------------------------------------------------------------
// normalizeProfileIdentifier
// ---------------------------------------------------------------------------

describe('SearchProfileService.normalizeProfileIdentifier', () => {
  it('lowercases and replaces spaces/underscores with hyphens', () => {
    expect(svc.normalizeProfileIdentifier('CNC Sales Profile')).toBe('cnc-sales-profile')
    expect(svc.normalizeProfileIdentifier('cnc_sales_profile')).toBe('cnc-sales-profile')
  })

  it('strips non-alphanumeric characters', () => {
    expect(svc.normalizeProfileIdentifier('CNC/销售@Profile!')).toBe('cnc-profile')
  })

  it('collapses multiple hyphens', () => {
    expect(svc.normalizeProfileIdentifier('a---b')).toBe('a-b')
  })

  it('strips leading/trailing hyphens', () => {
    expect(svc.normalizeProfileIdentifier('-profile-')).toBe('profile')
  })

  it('returns "profile" for empty/whitespace-only input', () => {
    expect(svc.normalizeProfileIdentifier('')).toBe('profile')
    expect(svc.normalizeProfileIdentifier('   ')).toBe('profile')
  })

  it('preserves digits and hyphens', () => {
    expect(svc.normalizeProfileIdentifier('Profile-123')).toBe('profile-123')
  })
})

// ---------------------------------------------------------------------------
// coerceProfile (via normalizeProfileInput) — filters
// ---------------------------------------------------------------------------

describe('SearchProfileService normalizeProfileInput — filters', () => {
  it('parses maxExperience', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      filters: { maxExperience: 10 },
    })
    expect(result.filters?.maxExperience).toBe(10)
  })

  it('allows null maxExperience to clear the field', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      filters: { maxExperience: null },
    })
    expect(result.filters?.maxExperience).toBeNull()
  })

  it('parses salaryRange', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      filters: { salaryRange: { min: 10000, max: 20000, currency: 'CNY', period: 'monthly' } },
    })
    expect(result.filters?.salaryRange).toEqual({ min: 10000, max: 20000, currency: 'CNY', period: 'monthly' })
  })

  it('parses education array', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      filters: { education: ['本科', '硕士'] },
    })
    expect(result.filters?.education).toEqual(['本科', '硕士'])
  })

  it('parses locations array', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      filters: { locations: ['深圳', '广州'] },
    })
    expect(result.filters?.locations).toEqual(['深圳', '广州'])
  })

  it('returns undefined when filters key is missing', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
    })
    expect(result.filters).toBeUndefined()
  })

  it('returns undefined when all filter fields are empty', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      filters: {},
    })
    expect(result.filters).toBeUndefined()
  })

  it('parses minAge and maxAge', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      filters: { minAge: 25, maxAge: 40 },
    })
    expect(result.filters?.minAge).toBe(25)
    expect(result.filters?.maxAge).toBe(40)
  })
})

// ---------------------------------------------------------------------------
// coerceProfile (via normalizeProfileInput) — schedule
// ---------------------------------------------------------------------------

describe('SearchProfileService normalizeProfileInput — schedule', () => {
  it('parses schedule with enabled and cron', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      schedule: { enabled: true, cron: '0 9 * * 1-5' },
    })
    expect(result.schedule).toEqual({ enabled: true, cron: '0 9 * * 1-5' })
  })

  it('returns undefined when schedule is empty', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      schedule: {},
    })
    expect(result.schedule).toBeUndefined()
  })

  it('returns undefined when only enabled is explicitly false with no other fields', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      schedule: { enabled: false },
    })
    expect(result.schedule).toBeUndefined()
  })

  it('parses timezone and maxCandidates', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      schedule: { enabled: true, timezone: 'Asia/Shanghai', maxCandidates: 50 },
    })
    expect(result.schedule?.timezone).toBe('Asia/Shanghai')
    expect(result.schedule?.maxCandidates).toBe(50)
  })
})

// ---------------------------------------------------------------------------
// coerceProfile (via normalizeProfileInput) — sources
// ---------------------------------------------------------------------------

describe('SearchProfileService normalizeProfileInput — sources', () => {
  it('parses source array with required fields', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      sources: [{ type: 'seek', enabled: true }],
    })
    expect(result.sources).toEqual([{ type: 'seek', enabled: true }])
  })

  it('skips sources missing type or enabled', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      sources: [{ type: 'seek' }, { enabled: true }, { type: '51job', enabled: true }],
    })
    expect(result.sources).toHaveLength(1)
    expect(result.sources![0]!.type).toBe('51job')
  })

  it('parses source with jobUrl and mode', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      sources: [{ type: 'seek', enabled: true, mode: 'recommended', jobUrl: 'https://hk.employer.seek.com/candidates/recommended' }],
    })
    expect(result.sources![0]!.mode).toBe('recommended')
    expect(result.sources![0]!.jobUrl).toBe('https://hk.employer.seek.com/candidates/recommended')
  })

  it('returns undefined for empty sources array', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      sources: [],
    })
    expect(result.sources).toBeUndefined()
  })

  it('returns undefined when sources key is missing', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
    })
    expect(result.sources).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// coerceProfile (via normalizeProfileInput) — quickStart
// ---------------------------------------------------------------------------

describe('SearchProfileService normalizeProfileInput — quickStart', () => {
  it('parses quickStart with enabled and label', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      quickStart: { enabled: true, label: 'Quick Start', rank: 1 },
    })
    expect(result.quickStart).toEqual({ enabled: true, label: 'Quick Start', rank: 1 })
  })

  it('returns undefined for empty quickStart', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      quickStart: {},
    })
    expect(result.quickStart).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// coerceProfile (via normalizeProfileInput) — notifications
// ---------------------------------------------------------------------------

describe('SearchProfileService normalizeProfileInput — notifications', () => {
  it('parses notifications with channels and triggers', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      notifications: {
        enabled: true,
        channels: [{ type: 'webhook', enabled: true, webhook: 'https://example.com/hook' }],
        triggers: [{ event: 'new_candidates', threshold: 5 }],
      },
    })
    expect(result.notifications?.enabled).toBe(true)
    expect(result.notifications?.channels).toHaveLength(1)
    expect(result.notifications?.triggers).toHaveLength(1)
  })

  it('returns undefined for empty notifications', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      notifications: {},
    })
    expect(result.notifications).toBeUndefined()
  })

  it('skips channel entries missing type or enabled', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      notifications: {
        enabled: true,
        channels: [{ type: 'webhook' }, { type: 'email', enabled: true }],
      },
    })
    expect(result.notifications?.channels).toHaveLength(1)
  })

  it('skips trigger entries missing event', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      notifications: {
        enabled: true,
        triggers: [{ threshold: 5 }, { event: 'new_candidates' }],
      },
    })
    expect(result.notifications?.triggers).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// coerceProfile (via normalizeProfileInput) — ai
// ---------------------------------------------------------------------------

describe('SearchProfileService normalizeProfileInput — ai', () => {
  it('parses ai config with pipeline', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      ai: {
        pipeline: [{ stage: 'screen', model: 'gpt-4', threshold: 0.8 }],
        generateOutreach: true,
        outreachTemplate: 'Hello {{name}}',
      },
    })
    expect(result.ai?.pipeline).toHaveLength(1)
    expect(result.ai?.generateOutreach).toBe(true)
    expect(result.ai?.outreachTemplate).toBe('Hello {{name}}')
  })

  it('returns undefined for empty ai config', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      ai: {},
    })
    expect(result.ai).toBeUndefined()
  })

  it('skips pipeline entries missing stage or model', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      ai: {
        pipeline: [{ stage: 'screen' }, { stage: 'screen', model: 'gpt-4' }],
      },
    })
    expect(result.ai?.pipeline).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// coerceProfile (via normalizeProfileInput) — session
// ---------------------------------------------------------------------------

describe('SearchProfileService normalizeProfileInput — session', () => {
  it('parses session with scope and retention', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      session: {
        scope: 'screening',
        resetTriggers: ['new_resume'],
        retention: { mode: 'archive', archiveAfterDays: 30 },
      },
    })
    expect(result.session?.scope).toBe('screening')
    expect(result.session?.resetTriggers).toEqual(['new_resume'])
    expect(result.session?.retention?.mode).toBe('archive')
    expect(result.session?.retention?.archiveAfterDays).toBe(30)
  })

  it('returns undefined for empty session', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['test'],
      session: {},
    })
    expect(result.session).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// coerceProfile — fallback behavior
// ---------------------------------------------------------------------------

describe('SearchProfileService normalizeProfileInput — fallback', () => {
  it('preserves existing values not in input', () => {
    const existing: SearchProfile = {
      id: 'existing',
      name: 'Existing Profile',
      status: 'active',
      location: '深圳',
      keywords: ['CNC'],
      jobDescription: 'jd-123',
      filterPreset: 'cnc-sales',
      filters: { maxExperience: 10 },
      schedule: { enabled: true, cron: '0 9 * * 1-5' },
    }
    const result = svc.normalizeProfileInput({ name: 'Updated' }, existing)
    expect(result.name).toBe('Updated')
    expect(result.location).toBe('深圳')
    expect(result.keywords).toEqual(['CNC'])
    expect(result.jobDescription).toBe('jd-123')
    expect(result.filterPreset).toBe('cnc-sales')
    expect(result.filters?.maxExperience).toBe(10)
    expect(result.schedule?.cron).toBe('0 9 * * 1-5')
  })

  it('clears optional fields when null is provided', () => {
    const existing: SearchProfile = {
      id: 'existing',
      name: 'Existing',
      status: 'active',
      location: '深圳',
      keywords: ['CNC'],
      jobDescription: 'jd-123',
      filterPreset: 'cnc-sales',
    }
    const result = svc.normalizeProfileInput({ jobDescription: null, filterPreset: null }, existing)
    expect(result.jobDescription).toBeUndefined()
    expect(result.filterPreset).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// coerceProfile — non-record input
// ---------------------------------------------------------------------------

describe('SearchProfileService normalizeProfileInput — non-record input', () => {
  it('handles null input by using defaults', () => {
    const result = svc.normalizeProfileInput(null)
    expect(result.id).toBe('profile')
    expect(result.name).toBe('profile')
    expect(result.keywords).toEqual([])
  })

  it('handles numeric input by using defaults', () => {
    const result = svc.normalizeProfileInput(42)
    expect(result.id).toBe('profile')
  })
})

// ---------------------------------------------------------------------------
// validateProfile
// ---------------------------------------------------------------------------

describe('SearchProfileService validateProfile', () => {
  it('throws when id is empty', () => {
    expect(() => svc.validateProfile({ id: '', name: 'Test', keywords: ['a'] } as SearchProfile)).toThrow(/id is required/)
  })

  it('throws when name is empty', () => {
    expect(() => svc.validateProfile({ id: 'p1', name: '', keywords: ['a'] } as SearchProfile)).toThrow(/name is required/)
  })

  it('throws when keywords is empty', () => {
    expect(() => svc.validateProfile({ id: 'p1', name: 'Test', keywords: [] } as SearchProfile)).toThrow(/keywords/)
  })

  it('does not throw for valid profile', () => {
    expect(() => svc.validateProfile({ id: 'p1', name: 'Test', status: 'active', location: '', keywords: ['a'] })).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// seek URL validation helpers (via validateProfile)
// ---------------------------------------------------------------------------

describe('SearchProfileService seek URL validation', () => {
  it('accepts seek recommended URL with mode=recommended', () => {
    expect(() =>
      svc.validateProfile({
        id: 'test',
        name: 'Test',
        status: 'active',
        location: '',
        keywords: ['a'],
        sources: [{
          type: 'seek',
          enabled: true,
          mode: 'recommended',
          jobUrl: 'https://hk.employer.seek.com/candidates/recommended',
        }],
      })
    ).not.toThrow()
  })

  it('accepts seek talentsearch URL with mode=talentsearch', () => {
    expect(() =>
      svc.validateProfile({
        id: 'test',
        name: 'Test',
        status: 'active',
        location: '',
        keywords: ['a'],
        sources: [{
          type: 'seek',
          enabled: true,
          mode: 'talentsearch',
          jobUrl: 'https://hk.employer.seek.com/talentsearch?keywords=test',
        }],
      })
    ).not.toThrow()
  })

  it('rejects seek recommended URL when mode is talentsearch', () => {
    expect(() =>
      svc.validateProfile({
        id: 'test',
        name: 'Test',
        status: 'active',
        location: '',
        keywords: ['a'],
        sources: [{
          type: 'seek',
          enabled: true,
          mode: 'talentsearch',
          jobUrl: 'https://hk.employer.seek.com/candidates/recommended',
        }],
      })
    ).toThrow(/Seek/)
  })

  it('rejects seek source with non-Seek URL', () => {
    expect(() =>
      svc.validateProfile({
        id: 'test',
        name: 'Test',
        status: 'active',
        location: '',
        keywords: ['a'],
        sources: [{
          type: 'seek',
          enabled: true,
          mode: 'recommended',
          jobUrl: 'https://example.com/not-seek',
        }],
      })
    ).toThrow(/Seek/)
  })

  it('skips validation for disabled seek sources', () => {
    expect(() =>
      svc.validateProfile({
        id: 'test',
        name: 'Test',
        status: 'active',
        location: '',
        keywords: ['a'],
        sources: [{
          type: 'seek',
          enabled: false,
          mode: 'recommended',
          jobUrl: 'https://example.com/not-seek',
        }],
      })
    ).not.toThrow()
  })

  it('skips validation for non-seek sources', () => {
    expect(() =>
      svc.validateProfile({
        id: 'test',
        name: 'Test',
        status: 'active',
        location: '',
        keywords: ['a'],
        sources: [{
          type: '51job',
          enabled: true,
          jobUrl: 'https://example.com/anything',
        }],
      })
    ).not.toThrow()
  })

  it('rejects seek source with empty jobUrl', () => {
    expect(() =>
      svc.validateProfile({
        id: 'test',
        name: 'Test',
        status: 'active',
        location: '',
        keywords: ['a'],
        sources: [{
          type: 'seek',
          enabled: true,
          mode: 'recommended',
        }],
      })
    ).toThrow(/Seek/)
  })
})

// ---------------------------------------------------------------------------
// coerceProfile — status parsing
// ---------------------------------------------------------------------------

describe('SearchProfileService normalizeProfileInput — status', () => {
  it('accepts valid status values', () => {
    for (const status of ['active', 'paused', 'archived'] as const) {
      const result = svc.normalizeProfileInput({ id: 'test', name: 'Test', keywords: ['a'], status })
      expect(result.status).toBe(status)
    }
  })

  it('defaults to active for invalid status', () => {
    const result = svc.normalizeProfileInput({ id: 'test', name: 'Test', keywords: ['a'], status: 'invalid' })
    expect(result.status).toBe('active')
  })

  it('defaults to active when status is missing', () => {
    const result = svc.normalizeProfileInput({ id: 'test', name: 'Test', keywords: ['a'] })
    expect(result.status).toBe('active')
  })

  it('falls back to existing status when not provided', () => {
    const existing: SearchProfile = { id: 'test', name: 'Test', status: 'paused', location: '', keywords: ['a'] }
    const result = svc.normalizeProfileInput({}, existing)
    expect(result.status).toBe('paused')
  })
})

// ---------------------------------------------------------------------------
// coerceProfile — description, createdAt, updatedAt
// ---------------------------------------------------------------------------

describe('SearchProfileService normalizeProfileInput — metadata fields', () => {
  it('parses description, createdAt, updatedAt', () => {
    const result = svc.normalizeProfileInput({
      id: 'test',
      name: 'Test',
      keywords: ['a'],
      description: 'A test profile',
      createdAt: '2024-01-01',
      updatedAt: '2024-06-01',
    })
    expect(result.description).toBe('A test profile')
    expect(result.createdAt).toBe('2024-01-01')
    expect(result.updatedAt).toBe('2024-06-01')
  })

  it('trims whitespace from string fields', () => {
    const result = svc.normalizeProfileInput({
      id: ' test ',
      name: ' Test ',
      keywords: ['a'],
      description: '  desc  ',
    })
    expect(result.id).toBe('test')
    expect(result.name).toBe('Test')
    expect(result.description).toBe('desc')
  })
})

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
