import { describe, expect, it } from 'vitest'
import {
  buildKeywordAnalysisId,
  buildResumeAnalysisLookupKeys,
  buildResumeAnalysisStorageKey,
  deriveAnalysisLookupKey,
  isResumeAnalysisKeyForJobDescription,
  resolveResumeAnalysisSourceKey,
} from './analysis-utils'

describe('buildKeywordAnalysisId', () => {
  it('matches backend output fixtures', () => {
    expect(buildKeywordAnalysisId([])).toBe('keyword-search')
    expect(buildKeywordAnalysisId(['CNC', '车床'])).toBe('keyword-search:2:282bc607')
    expect(buildKeywordAnalysisId(['  cnc ', 'CNC', '车床', ''])).toBe('keyword-search:2:282bc607')
    expect(buildKeywordAnalysisId(['车床', 'cnc', '销售'])).toBe('keyword-search:3:e4226b67')
    expect(buildKeywordAnalysisId(['销售', '车床', 'cnc', '销售'])).toBe('keyword-search:3:e4226b67')
  })

  it('changes when location or prompt version changes', () => {
    const base = buildKeywordAnalysisId(['销售', 'CNC'], {
      location: '广东',
      promptVersion: 1,
    })
    const differentLocation = buildKeywordAnalysisId(['销售', 'CNC'], {
      location: '江苏',
      promptVersion: 1,
    })
    const differentVersion = buildKeywordAnalysisId(['销售', 'CNC'], {
      location: '广东',
      promptVersion: 2,
    })

    expect(base).not.toBe(differentLocation)
    expect(base).not.toBe(differentVersion)
  })
})

describe('deriveAnalysisLookupKey', () => {
  it('prefers job description id', () => {
    expect(deriveAnalysisLookupKey('jd-lathe-sales', ['车床', '销售'])).toBe('jd-lathe-sales')
  })

  it('uses source-aware keys when a collection source is known', () => {
    expect(deriveAnalysisLookupKey('jd-lathe-sales', ['车床', '销售'], { sourceKey: 'seek' }))
      .toBe('source:seek|analysis:jd-lathe-sales')
  })

  it('falls back to keyword analysis id', () => {
    expect(deriveAnalysisLookupKey(undefined, ['CNC', '车床'], {
      location: '广东',
      promptVersion: 1,
    })).toMatch(/^keyword-search:2:/)
  })

  it('returns empty key when no context is provided', () => {
    expect(deriveAnalysisLookupKey(undefined, [])).toBe('')
  })
})

describe('source-aware analysis helpers', () => {
  it('builds storage keys with source prefixes and legacy fallback', () => {
    expect(buildResumeAnalysisStorageKey('jd-lathe-sales', { sourceKey: 'seek' }))
      .toBe('source:seek|analysis:jd-lathe-sales')
    expect(buildResumeAnalysisStorageKey('jd-lathe-sales')).toBe('jd-lathe-sales')
  })

  it('returns source-aware lookup keys before the legacy key', () => {
    expect(buildResumeAnalysisLookupKeys('jd-lathe-sales', [], { sourceKey: 'seek' })).toEqual([
      'source:seek|analysis:jd-lathe-sales',
      'jd-lathe-sales',
    ])
  })

  it('returns source-aware lookup keys for keyword searches before the legacy key', () => {
    const legacyKey = buildKeywordAnalysisId(['CNC', '销售'], {
      location: '东莞',
      promptVersion: 2,
    })

    expect(buildResumeAnalysisLookupKeys(undefined, ['CNC', '销售'], {
      location: '东莞',
      promptVersion: 2,
      sourceKey: 'job5156',
    })).toEqual([
      `source:job5156|analysis:${legacyKey}`,
      legacyKey,
    ])
  })

  it('matches both legacy and source-aware keys when clearing by JD', () => {
    expect(isResumeAnalysisKeyForJobDescription('jd-lathe-sales', 'jd-lathe-sales')).toBe(true)
    expect(isResumeAnalysisKeyForJobDescription('source:seek|analysis:jd-lathe-sales', 'jd-lathe-sales')).toBe(true)
    expect(isResumeAnalysisKeyForJobDescription('source:seek|analysis:jd-cnc', 'jd-lathe-sales')).toBe(false)
  })

  it('normalizes known source keys from source hosts and explicit values', () => {
    expect(resolveResumeAnalysisSourceKey({ source: 'hk.employer.seek.com' })).toBe('seek')
    expect(resolveResumeAnalysisSourceKey({ sourceKey: 'job5156' })).toBe('job5156')
    expect(resolveResumeAnalysisSourceKey({ source: '51job-manual' })).toBe('job5156')
    expect(resolveResumeAnalysisSourceKey({ sourceKey: '51job-manual' })).toBe('job5156')
    expect(resolveResumeAnalysisSourceKey({ source: 'manual.51job.com' })).toBeUndefined()
  })
})
