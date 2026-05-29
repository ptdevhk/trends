import { describe, expect, it } from 'vitest'
import { parseSalaryRange } from '@trends/shared'
import type { CandidateStatus } from '@/types/resume'

import {
  appendKeywordToken,
  areKeywordListsEqual,
  areUrlFiltersEqual,
  buildSearchHistoryTitle,
  getResumeIdentityKey,
  getResumeLocationText,
  getRoleYears,
  matchesAllRequiredKeywords,
  matchesEducationFilter,
  normalizeFilterList,
  normalizeFilterToken,
  normalizeKeywordFingerprint,
  normalizeOptionalNumber,
  normalizeOptionalString,
  normalizeUrlFilters,
  normalizeUrlSearchStateValue,
  parseExtractedAt,
  parseSerializedStringArray,
  matchesSalaryFilter,
  resolveAnalysisSourceKeyForResume,
  serializeLocationFilter,
  taskMatchesCurrentSearch,
  toExperienceLevel,
  toStatusFilterList,
} from './resume-filter-helpers.js'

import type { ConvexResumeItem } from '@/hooks/useConvexResumes'
import type { ResumeFilters } from '@/types/resume'

describe('normalizeFilterToken', () => {
  it('trims and lowercases input', () => {
    expect(normalizeFilterToken('  CNC  ')).toBe('cnc')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeFilterToken('   ')).toBe('')
  })

  it('lowercases Chinese text', () => {
    // Chinese has no case; returns trimmed
    expect(normalizeFilterToken(' 销售 ')).toBe('销售')
  })
})

describe('matchesEducationFilter', () => {
  it('returns true when no education levels are selected', () => {
    expect(matchesEducationFilter('本科', [])).toBe(true)
  })

  it('matches bachelor education (本科) against bachelor filter', () => {
    expect(matchesEducationFilter('本科', ['bachelor'])).toBe(true)
  })

  it('matches master education (硕士) against master filter', () => {
    expect(matchesEducationFilter('硕士', ['master'])).toBe(true)
  })

  it('does not match high school against bachelor filter', () => {
    expect(matchesEducationFilter('高中', ['bachelor'])).toBe(false)
  })

  it('returns false when education value is undefined and filters are set', () => {
    expect(matchesEducationFilter(undefined, ['bachelor'])).toBe(false)
  })

  it('matches when any selected level matches', () => {
    expect(matchesEducationFilter('大专', ['bachelor', 'associate'])).toBe(true)
  })

  it('matches phd filter against 博士', () => {
    expect(matchesEducationFilter('博士', ['phd'])).toBe(true)
  })

  it('matches English "bachelor" against bachelor filter', () => {
    expect(matchesEducationFilter('bachelor degree', ['bachelor'])).toBe(true)
  })
})

describe('parseSalaryRange', () => {
  it('parses a simple salary range string', () => {
    const result = parseSalaryRange('10-20')
    expect(result).not.toBeNull()
    expect(result!.min).toBe(10)
    expect(result!.max).toBe(20)
  })

  it('parses a single numeric value', () => {
    const result = parseSalaryRange('15')
    expect(result).not.toBeNull()
    expect(result!.min).toBe(15)
    expect(result!.max).toBeUndefined()
  })

  it('returns null for empty string', () => {
    expect(parseSalaryRange('')).toBeNull()
  })

  it('returns null for 面议 (negotiable)', () => {
    expect(parseSalaryRange('面议')).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(parseSalaryRange(undefined)).toBeNull()
  })

  it('parses salary with spaces', () => {
    const result = parseSalaryRange('10 - 20')
    expect(result).not.toBeNull()
    expect(result!.min).toBe(10)
  })

  it('parses salary with decimal values', () => {
    const result = parseSalaryRange('12.5-18.5')
    expect(result).not.toBeNull()
    expect(result!.min).toBe(12.5)
    expect(result!.max).toBe(18.5)
  })

  it('applies 万 multiplier for range', () => {
    expect(parseSalaryRange('15-25万/年')).toEqual({ min: 150, max: 250 })
  })

  it('applies 万 multiplier for single value', () => {
    expect(parseSalaryRange('15万/年')).toEqual({ min: 150, max: undefined })
  })

  it('applies 万 multiplier without period', () => {
    expect(parseSalaryRange('10-20万')).toEqual({ min: 100, max: 200 })
  })

  it('handles decimal values with 万', () => {
    expect(parseSalaryRange('1.5-2.5万/年')).toEqual({ min: 15, max: 25 })
  })
})

describe('matchesSalaryFilter', () => {
  it('returns true when no filters set', () => {
    expect(matchesSalaryFilter('10-20/月')).toBe(true)
  })

  it('returns false when salary is undefined and filters are set', () => {
    expect(matchesSalaryFilter(undefined, 5, 50)).toBe(false)
  })

  it('returns true when salary range overlaps min filter', () => {
    expect(matchesSalaryFilter('10-20/月', 5)).toBe(true)
  })

  it('returns false when salary upper bound is below min filter', () => {
    expect(matchesSalaryFilter('10-20/月', 25)).toBe(false)
  })

  it('returns true when salary range is below max filter', () => {
    expect(matchesSalaryFilter('10-20/月', undefined, 25)).toBe(true)
  })

  it('returns false when salary lower bound exceeds max filter', () => {
    expect(matchesSalaryFilter('10-20/月', undefined, 5)).toBe(false)
  })

  it('handles 万 multiplier in filter matching', () => {
    expect(matchesSalaryFilter('15-25万/年', 100, 300)).toBe(true)
  })

  it('rejects 万 salary below min filter', () => {
    expect(matchesSalaryFilter('15-25万/年', 300)).toBe(false)
  })
})

describe('toStatusFilterList', () => {
  it('returns empty array for undefined input', () => {
    expect(toStatusFilterList(undefined)).toEqual([])
  })

  it('filters to only valid candidate statuses', () => {
    const result = toStatusFilterList(['new', 'hired'] as CandidateStatus[])
    // Invalid values like 'invalid' would be filtered out by the type system
    // and by the function's runtime guard
    expect(result).toEqual(['hired', 'new'])
  })

  it('deduplicates statuses', () => {
    const result = toStatusFilterList(['new', 'new', 'hired'] as Array<'new' | 'hired'>)
    expect(result).toEqual(['hired', 'new'])
  })

  it('sorts statuses alphabetically', () => {
    const result = toStatusFilterList(['hired', 'new', 'contacted'] as Array<'hired' | 'new' | 'contacted'>)
    expect(result).toEqual(['contacted', 'hired', 'new'])
  })

  it('accepts all valid statuses', () => {
    const all = ['new', 'contacted', 'interviewing', 'interviewed_pass', 'interviewed_reject', 'offer', 'hired', 'withdrawn'] as const
    const result = toStatusFilterList([...all])
    expect(result).toHaveLength(8)
  })
})

describe('getRoleYears', () => {
  function makeResume(roleSignals: Array<{
    type: string
    years: number
    industryVerifiedYears?: number
    industryVerifiedRelevantYears?: number
    matchedWorkEntries?: Array<{ years: number; directRoleMatch: boolean; industryVerified: boolean; matchedSignals: string[] }>
  }>, verifiedRoleYears?: Record<string, number>): Pick<ConvexResumeItem, 'ingestData'> {
    return {
      ingestData: {
        evidenceText: '',
        industryTags: [],
        synonymHits: [],
        brandHits: [],
        companyHits: [],
        industryDbV2Raw: 0,
        roleSignals: roleSignals.map((s) => ({
          type: s.type,
          matchedSignals: [],
          signalCount: 1,
          occurrences: 1,
          years: s.years,
          industryVerifiedYears: s.industryVerifiedYears ?? 0,
          ...(s.industryVerifiedRelevantYears !== undefined ? { industryVerifiedRelevantYears: s.industryVerifiedRelevantYears } : {}),
          ...(s.matchedWorkEntries
            ? {
                matchedWorkEntries: s.matchedWorkEntries.map((e) => ({
                  ...e,
                  matchedSignals: e.industryVerified ? ['verified'] : [],
                  ...(e.directRoleMatch ? { companyName: 'Test Co', jobTitle: 'Test Title' } : {}),
                })),
              }
            : {}),
          verifyIn: '',
        })),
        ...(verifiedRoleYears ? { verifiedRoleYears } : {}),
        ruleScores: {},
        experienceLevel: 'mid',
        computedAt: 0,
        skillsVersion: 1,
      },
    }
  }

  it('returns 0 when ingestData has no roleSignals', () => {
    const resume = makeResume([])
    expect(getRoleYears(resume, '')).toBe(0)
  })

  it('prefers precomputed verifiedRoleYears when available', () => {
    const resume = makeResume(
      [{ type: 'sales', years: 8, industryVerifiedYears: 0 }],
      { sales: 5 },
    )
    expect(getRoleYears(resume, 'sales')).toBe(5)
  })

  it('falls back to getVerifiedRoleSignalYears via industryVerifiedRelevantYears', () => {
    const resume = makeResume([
      { type: 'sales', years: 8, industryVerifiedRelevantYears: 4 },
    ])
    expect(getRoleYears(resume, 'sales')).toBe(4)
  })

  it('sums verified work entry years when matchedWorkEntries are present', () => {
    const resume = makeResume([{
      type: 'sales',
      years: 8,
      matchedWorkEntries: [
        { years: 3, directRoleMatch: true, industryVerified: true, matchedSignals: ['verified'] },
        { years: 2, directRoleMatch: true, industryVerified: false, matchedSignals: [] },
      ],
    }])
    expect(getRoleYears(resume, 'sales')).toBe(3)
  })

  it('returns 0 when no signal matches the specified roleType', () => {
    const resume = makeResume([
      { type: 'engineer', years: 10, industryVerifiedYears: 10 },
    ])
    expect(getRoleYears(resume, 'sales')).toBe(0)
  })

  it('returns max verified years across all signals when roleType is empty', () => {
    const resume = makeResume([
      { type: 'sales', years: 5, industryVerifiedRelevantYears: 5 },
      { type: 'engineer', years: 8, industryVerifiedRelevantYears: 8 },
    ])
    expect(getRoleYears(resume, '')).toBe(8)
  })

  it('is case-insensitive for roleType matching', () => {
    const resume = makeResume([
      { type: 'Sales', years: 7, industryVerifiedRelevantYears: 7 },
    ])
    expect(getRoleYears(resume, 'sales')).toBe(7)
  })
})

describe('matchesAllRequiredKeywords', () => {
  it('returns true when requiredKeywords is empty', () => {
    expect(matchesAllRequiredKeywords('some text', [])).toBe(true)
  })

  it('returns true when all keywords are present in text', () => {
    expect(matchesAllRequiredKeywords('CNC 销售工程师', ['CNC', '销售'])).toBe(true)
  })

  it('returns false when any keyword is missing from text', () => {
    expect(matchesAllRequiredKeywords('CNC 工程师', ['CNC', '销售'])).toBe(false)
  })

  it('returns false for empty text with non-empty keywords', () => {
    expect(matchesAllRequiredKeywords('', ['CNC'])).toBe(false)
  })

  it('is case-insensitive for keyword matching', () => {
    expect(matchesAllRequiredKeywords('cnc engineer', ['CNC'])).toBe(true)
  })

  it('ignores whitespace-only keywords', () => {
    expect(matchesAllRequiredKeywords('CNC', ['CNC', '  '])).toBe(true)
  })
})

describe('normalizeKeywordFingerprint', () => {
  it('returns empty string for undefined', () => {
    expect(normalizeKeywordFingerprint(undefined)).toBe('')
  })

  it('returns empty string for empty array', () => {
    expect(normalizeKeywordFingerprint([])).toBe('')
  })

  it('normalizes, deduplicates, sorts and joins keywords', () => {
    // 'CNC' and 'cnc' should dedup; sorted alphabetically
    expect(normalizeKeywordFingerprint(['销售', 'CNC', 'cnc'])).toBe('cnc|销售')
  })

  it('trims whitespace from keywords', () => {
    expect(normalizeKeywordFingerprint(['  CNC  ', ' 销售 '])).toBe('cnc|销售')
  })
})

describe('areKeywordListsEqual', () => {
  it('returns true for two undefined lists', () => {
    expect(areKeywordListsEqual(undefined, undefined)).toBe(true)
  })

  it('returns true for identical keyword arrays', () => {
    expect(areKeywordListsEqual(['CNC', '销售'], ['CNC', '销售'])).toBe(true)
  })

  it('returns true for same keywords in different order', () => {
    expect(areKeywordListsEqual(['销售', 'CNC'], ['CNC', '销售'])).toBe(true)
  })

  it('returns true for case-insensitive match', () => {
    expect(areKeywordListsEqual(['cnc'], ['CNC'])).toBe(true)
  })

  it('returns false for different keywords', () => {
    expect(areKeywordListsEqual(['CNC'], ['销售'])).toBe(false)
  })

  it('returns false when one is empty and the other is not', () => {
    expect(areKeywordListsEqual([], ['CNC'])).toBe(false)
  })
})

describe('parseExtractedAt', () => {
  it('returns 0 for undefined', () => {
    expect(parseExtractedAt(undefined)).toBe(0)
  })

  it('returns 0 for empty string', () => {
    expect(parseExtractedAt('')).toBe(0)
  })

  it('returns 0 for invalid date string', () => {
    expect(parseExtractedAt('not-a-date')).toBe(0)
  })

  it('parses valid ISO date string to timestamp', () => {
    const result = parseExtractedAt('2026-04-24T00:00:00.000Z')
    expect(result).toBeGreaterThan(0)
    expect(typeof result).toBe('number')
  })
})

describe('parseSerializedStringArray', () => {
  it('parses valid JSON string array', () => {
    expect(parseSerializedStringArray('["a","b","c"]')).toEqual(['a', 'b', 'c'])
  })

  it('returns empty array for invalid JSON', () => {
    expect(parseSerializedStringArray('not-json')).toEqual([])
  })

  it('filters out non-string items', () => {
    expect(parseSerializedStringArray('[1, "ok", null, true]')).toEqual(['ok'])
  })

  it('returns empty array for JSON non-array', () => {
    expect(parseSerializedStringArray('{"key":"val"}')).toEqual([])
  })
})

describe('toExperienceLevel', () => {
  it('returns undefined for undefined', () => {
    expect(toExperienceLevel(undefined)).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(toExperienceLevel('')).toBeUndefined()
  })

  it('returns "senior" for "senior"', () => {
    expect(toExperienceLevel('senior')).toBe('senior')
  })

  it('returns "mid" for "mid"', () => {
    expect(toExperienceLevel('mid')).toBe('mid')
  })

  it('returns "junior" for "junior"', () => {
    expect(toExperienceLevel('junior')).toBe('junior')
  })

  it('is case-insensitive', () => {
    expect(toExperienceLevel('Senior')).toBe('senior')
  })

  it('returns undefined for unrecognized value', () => {
    expect(toExperienceLevel('expert')).toBeUndefined()
  })
})

describe('normalizeOptionalNumber', () => {
  it('returns undefined for undefined', () => {
    expect(normalizeOptionalNumber(undefined)).toBeUndefined()
  })

  it('returns the number for finite values', () => {
    expect(normalizeOptionalNumber(5)).toBe(5)
  })

  it('returns undefined for NaN', () => {
    expect(normalizeOptionalNumber(NaN)).toBeUndefined()
  })

  it('returns undefined for Infinity', () => {
    expect(normalizeOptionalNumber(Infinity)).toBeUndefined()
  })

  it('returns undefined for negative Infinity', () => {
    expect(normalizeOptionalNumber(-Infinity)).toBeUndefined()
  })

  it('returns 0 for zero', () => {
    expect(normalizeOptionalNumber(0)).toBe(0)
  })
})

describe('normalizeOptionalString', () => {
  it('returns undefined for undefined', () => {
    expect(normalizeOptionalString(undefined)).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(normalizeOptionalString('')).toBeUndefined()
  })

  it('returns undefined for whitespace-only string', () => {
    expect(normalizeOptionalString('   ')).toBeUndefined()
  })

  it('returns trimmed string for valid input', () => {
    expect(normalizeOptionalString('  CNC  ')).toBe('CNC')
  })
})

describe('normalizeFilterList', () => {
  it('returns undefined for undefined', () => {
    expect(normalizeFilterList(undefined)).toBeUndefined()
  })

  it('returns undefined for empty array', () => {
    expect(normalizeFilterList([])).toBeUndefined()
  })

  it('normalizes, deduplicates, and sorts tokens', () => {
    expect(normalizeFilterList(['CNC', 'cnc', '销售'])).toEqual(['cnc', '销售'])
  })

  it('filters out empty and whitespace tokens', () => {
    expect(normalizeFilterList(['CNC', '', '  '])).toEqual(['cnc'])
  })
})

describe('serializeLocationFilter', () => {
  it('returns empty string for undefined', () => {
    expect(serializeLocationFilter(undefined)).toBe('')
  })

  it('returns empty string for empty array', () => {
    expect(serializeLocationFilter([])).toBe('')
  })

  it('joins trimmed values with comma', () => {
    expect(serializeLocationFilter(['  广东  ', '深圳'])).toBe('广东,深圳')
  })

  it('deduplicates case-insensitively but preserves first occurrence casing', () => {
    const result = serializeLocationFilter(['Guangdong', 'guangdong'])
    expect(result).toBe('Guangdong')
  })

  it('filters out empty and whitespace-only values', () => {
    expect(serializeLocationFilter(['广东', '', '  ', '深圳'])).toBe('广东,深圳')
  })
})

describe('appendKeywordToken', () => {
  it('appends trimmed token to array', () => {
    expect(appendKeywordToken(['CNC'], ' 销售 ')).toEqual(['CNC', '销售'])
  })

  it('returns unchanged array for whitespace-only token', () => {
    const arr = ['CNC']
    expect(appendKeywordToken(arr, '   ')).toBe(arr)
  })

  it('returns unchanged array for empty token', () => {
    const arr = ['CNC']
    expect(appendKeywordToken(arr, '')).toBe(arr)
  })
})

describe('normalizeUrlFilters', () => {
  it('normalizes all fields to their default values for empty input', () => {
    const result = normalizeUrlFilters({})
    expect(result.maxExperience).toBeUndefined()
    expect(result.minRoleYears).toBeUndefined()
    expect(result.roleFilterType).toBeUndefined()
    expect(result.minAge).toBeUndefined()
    expect(result.maxAge).toBeUndefined()
    expect(result.education).toBeUndefined()
    expect(result.status).toEqual([])
    expect(result.minMatchScore).toBeUndefined()
    expect(result.locations).toBeUndefined()
    expect(result.sortBy).toBeUndefined()
    expect(result.sortOrder).toBeUndefined()
  })

  it('normalizes all number fields', () => {
    const result = normalizeUrlFilters({
      maxExperience: NaN,
      minRoleYears: 3,
      minAge: 0,
      maxAge: Infinity,
      minMatchScore: undefined,
    })
    expect(result.maxExperience).toBeUndefined()
    expect(result.minRoleYears).toBe(3)
    expect(result.minAge).toBe(0)
    expect(result.maxAge).toBeUndefined()
    expect(result.minMatchScore).toBeUndefined()
  })

  it('normalizes string and list fields', () => {
    const result = normalizeUrlFilters({
      roleFilterType: '  Sales  ',
      education: ['Bachelor', 'bachelor', 'Master'],
      locations: [' 广东 ', '深圳'],
      status: ['new', 'hired'] as CandidateStatus[],
    })
    expect(result.roleFilterType).toBe('Sales')
    expect(result.education).toEqual(['bachelor', 'master'])
    expect(result.locations).toEqual(['广东', '深圳'])
    expect(result.status).toEqual(['hired', 'new'])
  })

  it('passes through sortBy and sortOrder unchanged', () => {
    const result = normalizeUrlFilters({
      sortBy: 'score',
      sortOrder: 'desc',
    })
    expect(result.sortBy).toBe('score')
    expect(result.sortOrder).toBe('desc')
  })
})

describe('normalizeUrlSearchStateValue', () => {
  it('returns defaults for undefined input', () => {
    const result = normalizeUrlSearchStateValue(undefined)
    expect(result.shareSessionId).toBeUndefined()
    expect(result.query).toBeUndefined()
    expect(result.location).toBeUndefined()
    expect(result.keywords).toEqual([])
    expect(result.requiredKeywords).toEqual([])
    expect(result.jobDescriptionId).toBeUndefined()
    expect(result.selectedTags).toEqual([])
    expect(result.selectedCompanies).toEqual([])
    expect(result.selectedSources).toEqual([])
    expect(result.selectedExperienceLevel).toBeUndefined()
    expect(result.filters).toEqual({})
  })

  it('normalizes string fields and preserves arrays', () => {
    const result = normalizeUrlSearchStateValue({
      shareSessionId: '  abc  ',
      query: 'CNC',
      location: '  广东  ',
      keywords: ['CNC', '销售'],
      requiredKeywords: ['5轴'],
      jobDescriptionId: '  jd-1  ',
      selectedTags: ['tag1'],
      selectedCompanies: ['co1'],
      selectedSources: ['job5156'],
      selectedExperienceLevel: 'senior',
      filters: {},
    })
    expect(result.shareSessionId).toBe('abc')
    expect(result.query).toBe('CNC')
    expect(result.location).toBe('广东')
    expect(result.keywords).toEqual(['CNC', '销售'])
    expect(result.requiredKeywords).toEqual(['5轴'])
    expect(result.jobDescriptionId).toBe('jd-1')
    expect(result.selectedExperienceLevel).toBe('senior')
    expect(result.filters).toEqual({})
  })

  it('replaces non-array keywords with empty array', () => {
    const result = normalizeUrlSearchStateValue({
      keywords: 'not-an-array' as unknown as string[],
    })
    expect(result.keywords).toEqual([])
  })

  it('preserves empty filters as empty object', () => {
    const result = normalizeUrlSearchStateValue({ filters: {} })
    expect(result.filters).toEqual({})
  })
})

describe('areUrlFiltersEqual', () => {
  it('returns true for two empty filter objects', () => {
    expect(areUrlFiltersEqual({}, {})).toBe(true)
  })

  it('returns true for semantically equal filters ignoring order', () => {
    const left: Partial<ResumeFilters> = { education: ['Bachelor', 'Master'], maxExperience: 5 }
    const right: Partial<ResumeFilters> = { education: ['Master', 'Bachelor'], maxExperience: 5 }
    expect(areUrlFiltersEqual(left, right)).toBe(true)
  })

  it('returns false for different filters', () => {
    const left: Partial<ResumeFilters> = { maxExperience: 5 }
    const right: Partial<ResumeFilters> = { maxExperience: 10 }
    expect(areUrlFiltersEqual(left, right)).toBe(false)
  })

  it('treats NaN and undefined as equal for number fields', () => {
    const left: Partial<ResumeFilters> = { maxExperience: NaN }
    const right: Partial<ResumeFilters> = { maxExperience: undefined }
    expect(areUrlFiltersEqual(left, right)).toBe(true)
  })

  it('treats whitespace and trimmed strings as equal', () => {
    const left: Partial<ResumeFilters> = { roleFilterType: '  Sales  ' }
    const right: Partial<ResumeFilters> = { roleFilterType: 'Sales' }
    expect(areUrlFiltersEqual(left, right)).toBe(true)
  })
})


describe('taskMatchesCurrentSearch', () => {
  it('returns false for completed task', () => {
    const task = { status: 'completed', config: { promptVersion: 10 } }
    expect(taskMatchesCurrentSearch(task, undefined, [], '', 10)).toBe(false)
  })

  it('matches by jobDescriptionId with same promptVersion and location', () => {
    const task = {
      status: 'pending',
      config: { jobDescriptionId: 'jd-1', promptVersion: 10, location: ' 广东 ' },
    }
    expect(taskMatchesCurrentSearch(task, 'jd-1', [], '广东', 10)).toBe(true)
  })

  it('rejects JD match when promptVersion differs', () => {
    const task = {
      status: 'pending',
      config: { jobDescriptionId: 'jd-1', promptVersion: 8, location: undefined },
    }
    expect(taskMatchesCurrentSearch(task, 'jd-1', [], '', 10)).toBe(false)
  })

  it('matches by keywords with same fingerprint, promptVersion, and location', () => {
    const task = {
      status: 'processing',
      config: { keywords: ['CNC', '销售'], promptVersion: 10, location: '深圳' },
    }
    expect(taskMatchesCurrentSearch(task, '', ['销售', 'CNC'], '深圳', 10)).toBe(true)
  })

  it('rejects keyword match when fingerprints differ', () => {
    const task = {
      status: 'pending',
      config: { keywords: ['CNC'], promptVersion: 10, location: '' },
    }
    expect(taskMatchesCurrentSearch(task, '', ['销售'], '', 10)).toBe(false)
  })

  it('returns false when both JD and keywords are empty', () => {
    const task = {
      status: 'pending',
      config: { promptVersion: 10, location: '' },
    }
    expect(taskMatchesCurrentSearch(task, '', [], '', 10)).toBe(false)
  })

  it('rejects keyword match when session has no keywords', () => {
    const task = {
      status: 'pending',
      config: { keywords: ['CNC'], promptVersion: 10, location: '' },
    }
    expect(taskMatchesCurrentSearch(task, '', [], '', 10)).toBe(false)
  })
})

describe('buildSearchHistoryTitle', () => {
  it('returns "Untitled search" for empty inputs', () => {
    expect(buildSearchHistoryTitle('', [], undefined)).toBe('Untitled search')
  })

  it('joins location and keywords with separator', () => {
    expect(buildSearchHistoryTitle(' 广东 ', ['CNC', '销售'], undefined)).toBe('广东 · CNC 销售')
  })

  it('uses jobDescriptionId when no keywords', () => {
    expect(buildSearchHistoryTitle('', [], '  jd-1  ')).toBe('jd-1')
  })

  it('prefers keywords over jobDescriptionId', () => {
    expect(buildSearchHistoryTitle('', ['CNC'], 'jd-1')).toBe('CNC')
  })

  it('combines location and jobDescriptionId', () => {
    expect(buildSearchHistoryTitle('深圳', [], 'jd-1')).toBe('深圳 · jd-1')
  })
})

describe('getResumeLocationText', () => {
  it('returns empty string when no location data', () => {
    expect(getResumeLocationText({})).toBe('')
  })

  it('returns locationHierarchy text when available', () => {
    expect(getResumeLocationText({
      locationHierarchy: { country: 'CN', province: '广东', city: '深圳' },
      location: '广东省深圳市',
    })).toBe('CN 广东 深圳')
  })

  it('falls back to location string when no hierarchy', () => {
    expect(getResumeLocationText({ location: '广东省深圳市' })).toBe('广东省深圳市')
  })

  it('returns empty string when hierarchy is empty and location is empty', () => {
    expect(getResumeLocationText({ location: '', locationHierarchy: { country: '' } })).toBe('')
  })
})

describe('resolveAnalysisSourceKeyForResume', () => {
  it('returns collectionSource type when available', () => {
    const result = resolveAnalysisSourceKeyForResume(
      { source: 'job5156', profileType: 'profile' },
      { type: '51job' },
    )
    expect(result).toBe('51job')
  })

  it('falls back to resolveResumeAnalysisSourceKey when no collectionSource', () => {
    const result = resolveAnalysisSourceKeyForResume(
      { source: 'job5156' },
      undefined,
    )
    expect(result).toBe('job5156')
  })

  it('returns undefined when no collectionSource and no recognized source', () => {
    const result = resolveAnalysisSourceKeyForResume(
      { source: 'unknown' },
      undefined,
    )
    expect(result).toBeUndefined()
  })

  it('uses profileType as sourceKey for resolveResumeAnalysisSourceKey', () => {
    const result = resolveAnalysisSourceKeyForResume(
      { source: 'job5156', profileType: 'seek' },
      undefined,
    )
    expect(result).toBe('seek')
  })
})

describe('getResumeIdentityKey', () => {
  it('returns identityKey when present', () => {
    expect(getResumeIdentityKey({ identityKey: '  abc-123  ' } as ConvexResumeItem, 'fallback')).toBe('abc-123')
  })

  it('returns fallback when identityKey is empty string', () => {
    expect(getResumeIdentityKey({ identityKey: '' } as ConvexResumeItem, 'fallback')).toBe('fallback')
  })

  it('returns fallback when identityKey is whitespace-only', () => {
    expect(getResumeIdentityKey({ identityKey: '   ' } as ConvexResumeItem, 'fallback')).toBe('fallback')
  })

  it('returns fallback when identityKey is undefined', () => {
    expect(getResumeIdentityKey({} as ConvexResumeItem, 'fallback')).toBe('fallback')
  })
})

describe('idOrNameSearch filter logic', () => {
  function matchesIdOrName(
    resumeId: string,
    name: string,
    needle: string | undefined,
  ): boolean {
    if (!needle || needle.trim() === '') return true
    const n = needle.trim().toLowerCase()
    return (
      resumeId.toLowerCase().includes(n) ||
      (name ?? '').toLowerCase().includes(n)
    )
  }

  it('returns true when needle is absent', () => {
    expect(matchesIdOrName('id-abc', '张三', undefined)).toBe(true)
  })

  it('matches partial resumeId (case-insensitive)', () => {
    expect(matchesIdOrName('ResID-abc123', '张三', 'abc')).toBe(true)
    expect(matchesIdOrName('ResID-abc123', '张三', 'xyz')).toBe(false)
  })

  it('matches partial candidate name (case-insensitive)', () => {
    expect(matchesIdOrName('id-1', 'John Smith', 'smith')).toBe(true)
    expect(matchesIdOrName('id-1', '王小明', '小明')).toBe(true)
    expect(matchesIdOrName('id-1', 'John Smith', 'jones')).toBe(false)
  })

  it('returns true when needle is blank string', () => {
    expect(matchesIdOrName('id-1', 'John', '  ')).toBe(true)
  })
})
