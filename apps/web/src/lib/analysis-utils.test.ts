import { describe, expect, it } from 'vitest'
import { buildKeywordAnalysisId, deriveAnalysisLookupKey } from './analysis-utils'

describe('buildKeywordAnalysisId', () => {
  it('matches backend output fixtures', () => {
    expect(buildKeywordAnalysisId([])).toBe('keyword-search')
    expect(buildKeywordAnalysisId(['CNC', '车床'])).toBe('keyword-search:2:2223e0c7')
    expect(buildKeywordAnalysisId(['  cnc ', 'CNC', '车床', ''])).toBe('keyword-search:2:2223e0c7')
    expect(buildKeywordAnalysisId(['车床', 'cnc', '销售'])).toBe('keyword-search:3:15637327')
    expect(buildKeywordAnalysisId(['销售', '车床', 'cnc', '销售'])).toBe('keyword-search:3:15637327')
  })
})

describe('deriveAnalysisLookupKey', () => {
  it('prefers job description id', () => {
    expect(deriveAnalysisLookupKey('jd-lathe-sales', ['车床', '销售'])).toBe('jd-lathe-sales')
  })

  it('falls back to keyword analysis id', () => {
    expect(deriveAnalysisLookupKey(undefined, ['CNC', '车床'])).toBe('keyword-search:2:2223e0c7')
  })

  it('returns empty key when no context is provided', () => {
    expect(deriveAnalysisLookupKey(undefined, [])).toBe('')
  })
})
