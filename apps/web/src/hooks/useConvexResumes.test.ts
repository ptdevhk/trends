import { describe, expect, it } from 'vitest'
import {
  buildFallbackKeywordExpansion,
  matchesKeywordExpansion,
  parseAnalysesMap,
  parseAnalysis,
  parseBrandHits,
  parseBreakdown,
  parseIngestData,
  parseRuleScores,
  parseTaggingEnvelope,
  toNumber,
  toStringArray,
  toStringValue,
} from './useConvexResumes'

// ── toStringValue ──────────────────────────────────────────────

describe('toStringValue', () => {
  it('returns string as-is', () => {
    expect(toStringValue('hello')).toBe('hello')
  })

  it('returns number as string', () => {
    expect(toStringValue(42)).toBe('42')
  })

  it('returns empty string for null/undefined', () => {
    expect(toStringValue(null)).toBe('')
    expect(toStringValue(undefined)).toBe('')
  })

  it('returns stringified representation for objects', () => {
    expect(toStringValue({})).toBe('[object Object]')
  })
})

// ── toStringArray ──────────────────────────────────────────────

describe('toStringArray', () => {
  it('returns string array as-is', () => {
    expect(toStringArray(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('returns empty array for non-array', () => {
    expect(toStringArray('not-array')).toEqual([])
    expect(toStringArray(null)).toEqual([])
  })

  it('preserves empty strings in array', () => {
    expect(toStringArray(['a', '', 'b'])).toEqual(['a', '', 'b'])
  })

  it('filters non-string items', () => {
    expect(toStringArray(['a', 42, null, 'b'] as unknown[])).toEqual(['a', 'b'])
  })
})

// ── toNumber ───────────────────────────────────────────────────

describe('toNumber', () => {
  it('returns number as-is', () => {
    expect(toNumber(42)).toBe(42)
  })

  it('parses numeric strings', () => {
    expect(toNumber('3.14')).toBe(3.14)
  })

  it('returns null for non-numeric', () => {
    expect(toNumber('abc')).toBeNull()
    expect(toNumber(null)).toBeNull()
    expect(toNumber(undefined)).toBeNull()
  })

  it('returns null for NaN', () => {
    expect(toNumber(NaN)).toBeNull()
  })
})

// ── parseBreakdown ─────────────────────────────────────────────

describe('parseBreakdown', () => {
  it('parses valid breakdown', () => {
    expect(parseBreakdown({ experience: 8, education: 5 })).toEqual({ experience: 8, education: 5 })
  })

  it('skips non-numeric values', () => {
    expect(parseBreakdown({ a: 1, b: 'bad' })).toEqual({ a: 1 })
  })

  it('returns undefined for non-record', () => {
    expect(parseBreakdown(null)).toBeUndefined()
    expect(parseBreakdown('string')).toBeUndefined()
  })

  it('preserves reviewed industry evidence projections from Convex', () => {
    const result = parseIngestData({
      industryTags: ['cnc'],
      synonymHits: [],
      brandHits: [],
      companyHits: [],
      ruleScores: {},
      experienceLevel: 'senior',
      evidenceProjectionVersion: 1,
      industryEvidenceCatalogState: 'ready',
      industryEvidenceStale: false,
      verifiedIndustryEvidenceSummaries: [
        {
          companyKey: 'acme-cnc-demo',
          companyName: 'ACME CNC Demo',
          industryClass: 'cnc',
          verificationLevel: 'verified',
          verdictRevisionId: 'revision-acme-cnc-demo-1',
          evidenceSummary: 'Synthetic reviewed evidence.',
          reviewedAt: 1_700_000_000_000,
          sourceCount: 1,
          sourcePreviews: [
            {
              sourceId: 'source-1',
              url: 'https://example.com/acme-cnc',
              sourceDomain: 'example.com',
              sourceType: 'official_site',
              trustTier: 'primary',
            },
          ],
          additionalSourceCount: 0,
        },
      ],
    })

    expect(result).toMatchObject({
      evidenceProjectionVersion: 1,
      industryEvidenceCatalogState: 'ready',
      industryEvidenceStale: false,
    })
    expect(result?.verifiedIndustryEvidenceSummaries).toHaveLength(1)
    expect(result?.verifiedIndustryEvidenceSummaries?.[0]?.companyName).toBe(
      'ACME CNC Demo',
    )
  })

  it('returns undefined for empty object', () => {
    expect(parseBreakdown({})).toBeUndefined()
  })
})

// ── parseAnalysis ──────────────────────────────────────────────

describe('parseAnalysis', () => {
  it('parses valid analysis', () => {
    const result = parseAnalysis({
      score: 85,
      summary: 'Good candidate',
      highlights: ['strong background'],
      recommendation: 'proceed',
    })
    expect(result).toBeDefined()
    expect(result!.score).toBe(85)
    expect(result!.summary).toBe('Good candidate')
    expect(result!.highlights).toEqual(['strong background'])
    expect(result!.recommendation).toBe('proceed')
  })

  it('returns undefined for non-record', () => {
    expect(parseAnalysis(null)).toBeUndefined()
    expect(parseAnalysis(42)).toBeUndefined()
  })

  it('returns undefined when score is missing', () => {
    expect(parseAnalysis({ summary: 'no score' })).toBeUndefined()
  })

  it('uses defaults for optional fields', () => {
    const result = parseAnalysis({ score: 70 })
    expect(result).not.toBeNull()
    expect(result!.score).toBe(70)
    expect(result!.summary).toBe('')
    expect(result!.highlights).toEqual([])
  })
})

// ── parseRuleScores ────────────────────────────────────────────

describe('parseRuleScores', () => {
  it('parses valid rule scores', () => {
    expect(parseRuleScores({ leadership: 90, technical: 75 })).toEqual({ leadership: 90, technical: 75 })
  })

  it('skips non-numeric values', () => {
    expect(parseRuleScores({ a: 10, b: 'bad' })).toEqual({ a: 10 })
  })

  it('returns empty object for non-record', () => {
    expect(parseRuleScores(null)).toEqual({})
  })

  it('returns empty object for empty input', () => {
    expect(parseRuleScores({})).toEqual({})
  })
})

// ── parseBrandHits ─────────────────────────────────────────────

describe('parseBrandHits', () => {
  it('parses valid brand hits', () => {
    const input = [{ brand: 'Alibaba', role: 'Engineer', source: 'workHistory', context: 'senior' }]
    expect(parseBrandHits(input)).toEqual(input)
  })

  it('filters items with missing required fields', () => {
    const input = [
      { brand: 'Alibaba', role: 'Engineer', source: 'workHistory', context: 'senior' },
      { brand: '', role: 'Engineer', source: 'workHistory', context: 'senior' },
    ]
    expect(parseBrandHits(input)).toHaveLength(1)
  })

  it('returns empty array for non-array', () => {
    expect(parseBrandHits(null)).toEqual([])
    expect(parseBrandHits({})).toEqual([])
  })
})

// ── parseTaggingEnvelope ───────────────────────────────────────

describe('parseTaggingEnvelope', () => {
  it('parses valid tagging envelope', () => {
    const input = {
      schemaVersion: 1,
      generatedAt: 1700000000,
      entries: [
        {
          tag: 'python',
          source: 'skills',
          confidence: 0.95,
          version: 2,
          provenance: { stage: 'verified', generatedBy: 'pipeline', evidence: ['resume line 5'] },
        },
      ],
    }
    const result = parseTaggingEnvelope(input)
    expect(result).toBeDefined()
    expect(result!.entries).toHaveLength(1)
    expect(result!.entries[0].tag).toBe('python')
  })

  it('returns undefined for non-record', () => {
    expect(parseTaggingEnvelope(null)).toBeUndefined()
  })

  it('returns undefined when schemaVersion or generatedAt missing', () => {
    expect(parseTaggingEnvelope({ entries: [] })).toBeUndefined()
  })

  it('returns undefined when no valid entries', () => {
    const input = { schemaVersion: 1, generatedAt: 1700000000, entries: [{ tag: '' }] }
    expect(parseTaggingEnvelope(input)).toBeUndefined()
  })
})

// ── parseAnalysesMap ───────────────────────────────────────────

describe('parseAnalysesMap', () => {
  it('parses valid analyses map', () => {
    const input = {
      jd1: { score: 80, summary: 'Match', highlights: [], recommendation: 'proceed' },
    }
    const result = parseAnalysesMap(input)
    expect(result).toBeDefined()
    expect(result!.jd1.score).toBe(80)
  })

  it('returns undefined for empty map', () => {
    expect(parseAnalysesMap({})).toBeUndefined()
  })

  it('returns undefined for non-record', () => {
    expect(parseAnalysesMap(null)).toBeUndefined()
  })

  it('skips entries with invalid analysis', () => {
    const input = { jd1: { noScore: true }, jd2: { score: 70 } }
    const result = parseAnalysesMap(input)
    expect(result).toBeDefined()
    expect(Object.keys(result!)).toEqual(['jd2'])
  })
})

// ── parseIngestData ────────────────────────────────────────────

describe('parseIngestData', () => {
  it('parses valid ingest data', () => {
    const input = {
      industryTags: ['tech', 'finance'],
      synonymHits: ['java'],
      brandHits: [],
      companyHits: ['Alibaba'],
      ruleScores: { tech: 85 },
      experienceLevel: 'senior',
    }
    const result = parseIngestData(input)
    expect(result).toBeDefined()
    expect(result!.industryTags).toEqual(['tech', 'finance'])
    expect(result!.experienceLevel).toBe('senior')
  })

  it('parses market field for MY resumes', () => {
    const input = {
      industryTags: [],
      synonymHits: [],
      brandHits: [],
      companyHits: [],
      ruleScores: {},
      experienceLevel: 'unknown',
      market: 'MY',
    }
    const result = parseIngestData(input)
    expect(result).toBeDefined()
    expect(result!.market).toBe('MY')
  })

  it('returns undefined market when not present', () => {
    const input = {
      industryTags: [],
      synonymHits: [],
      brandHits: [],
      companyHits: [],
      ruleScores: {},
      experienceLevel: 'unknown',
    }
    const result = parseIngestData(input)
    expect(result).toBeDefined()
    expect(result!.market).toBeUndefined()
  })

  it('returns undefined for non-record', () => {
    expect(parseIngestData(null)).toBeUndefined()
    expect(parseIngestData('string')).toBeUndefined()
  })

  it('handles missing optional fields', () => {
    const input = {
      industryTags: [],
      synonymHits: [],
      brandHits: [],
      companyHits: [],
      ruleScores: {},
      experienceLevel: 'unknown',
    }
    const result = parseIngestData(input)
    expect(result).toBeDefined()
    expect(result!.computedAt).toBeUndefined()
    expect(result!.skillsVersion).toBeUndefined()
  })
})

// ── buildFallbackKeywordExpansion ──────────────────────────────

describe('buildFallbackKeywordExpansion', () => {
  it('builds expansion from simple query', () => {
    const result = buildFallbackKeywordExpansion('java python')
    expect(result.groups).toHaveLength(2)
    expect(result.mode).toBe('AND')
    expect(result.expandedTo).toEqual(['java', 'python'])
  })

  it('handles OR mode', () => {
    const result = buildFallbackKeywordExpansion('java OR python')
    expect(result.mode).toBe('OR')
  })

  it('trims and lowercases terms', () => {
    const result = buildFallbackKeywordExpansion('  Java  Python  ')
    expect(result.expandedTo).toEqual(['java', 'python'])
  })

  it('filters empty terms', () => {
    const result = buildFallbackKeywordExpansion('java   python')
    expect(result.expandedTo).toEqual(['java', 'python'])
  })
})

// ── matchesKeywordExpansion ────────────────────────────────────

describe('matchesKeywordExpansion', () => {
  const expansion = buildFallbackKeywordExpansion('java python')

  it('finds matching terms in search text', () => {
    const result = matchesKeywordExpansion('experienced java developer', expansion)
    expect(result).toHaveLength(1)
    expect(result[0].term).toBe('java')
    expect(result[0].source).toBe('searchText')
  })

  it('finds multiple matches', () => {
    const result = matchesKeywordExpansion('java and python developer', expansion)
    expect(result).toHaveLength(2)
  })

  it('returns empty when no terms match', () => {
    const result = matchesKeywordExpansion('c++ developer', expansion)
    expect(result).toHaveLength(0)
  })

  it('deduplicates matching variants in same group', () => {
    const expansionWithDupes = buildFallbackKeywordExpansion('java')
    const result = matchesKeywordExpansion('java java java', expansionWithDupes)
    expect(result).toHaveLength(1)
  })
})
