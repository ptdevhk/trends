import { describe, expect, it } from 'vitest'
import type { CandidateStatus } from '@/types/resume'

import {
  appendKeywordToken,
  areKeywordListsEqual,
  getRoleYears,
  matchesAllRequiredKeywords,
  matchesEducationFilter,
  normalizeFilterList,
  normalizeFilterToken,
  normalizeKeywordFingerprint,
  normalizeOptionalNumber,
  normalizeOptionalString,
  parseExtractedAt,
  parseSerializedStringArray,
  parseSalaryRange,
  serializeLocationFilter,
  toExperienceLevel,
  toStatusFilterList,
} from './resume-filter-helpers.js'

import type { ConvexResumeItem } from '@/hooks/useConvexResumes'

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
  function makeResume(roleSignals: Array<{ type: string; years: number; roleRelevantYears?: number }>): Pick<ConvexResumeItem, 'ingestData'> {
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
          industryVerifiedYears: 0,
          verifyIn: '',
          ...(s.roleRelevantYears !== undefined ? { roleRelevantYears: s.roleRelevantYears } : {}),
        })),
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

  it('returns max years across all signals when roleType is empty', () => {
    const resume = makeResume([
      { type: 'sales', years: 5 },
      { type: 'engineer', years: 8 },
    ])
    expect(getRoleYears(resume, '')).toBe(8)
  })

  it('returns roleRelevantYears when available for matching roleType', () => {
    const resume = makeResume([
      { type: 'sales', years: 8, roleRelevantYears: 5 },
    ])
    expect(getRoleYears(resume, 'sales')).toBe(5)
  })

  it('falls back to years when roleRelevantYears is absent for matching roleType', () => {
    const resume = makeResume([
      { type: 'sales', years: 6 },
    ])
    expect(getRoleYears(resume, 'sales')).toBe(6)
  })

  it('returns 0 when no signal matches the specified roleType', () => {
    const resume = makeResume([
      { type: 'engineer', years: 10 },
    ])
    expect(getRoleYears(resume, 'sales')).toBe(0)
  })

  it('ignores NaN and Infinity roleRelevantYears', () => {
    const resume = makeResume([
      { type: 'sales', years: 5, roleRelevantYears: NaN },
    ])
    expect(getRoleYears(resume, 'sales')).toBe(5)
  })

  it('is case-insensitive for roleType matching', () => {
    const resume = makeResume([
      { type: 'Sales', years: 7 },
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
