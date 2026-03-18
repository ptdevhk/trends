import { describe, expect, it } from 'vitest'
import { buildKeywordAnalysisId, deriveAnalysisLookupKey } from './analysis-utils'

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
