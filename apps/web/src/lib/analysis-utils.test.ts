import { describe, expect, it } from 'vitest'
import { resolveAnalysisTopN } from '@/lib/analysis-utils'

describe('resolveAnalysisTopN', () => {
  it('returns default for undefined', () => {
    expect(resolveAnalysisTopN(undefined)).toBe(10)
  })

  it('returns default for NaN', () => {
    expect(resolveAnalysisTopN('not-a-number')).toBe(10)
  })

  it('returns default for zero', () => {
    expect(resolveAnalysisTopN(0)).toBe(10)
  })

  it('returns default for negative', () => {
    expect(resolveAnalysisTopN(-5)).toBe(10)
  })

  it('returns parsed number for valid number input', () => {
    expect(resolveAnalysisTopN(25)).toBe(25)
  })

  it('parses string number', () => {
    expect(resolveAnalysisTopN('50')).toBe(50)
  })

  it('floors decimal values', () => {
    expect(resolveAnalysisTopN(25.7)).toBe(25)
  })

  it('caps at MAX_ANALYSIS_TOP_N (500)', () => {
    expect(resolveAnalysisTopN(1000)).toBe(500)
  })

  it('caps string input at MAX_ANALYSIS_TOP_N', () => {
    expect(resolveAnalysisTopN('999')).toBe(500)
  })

  it('accepts boundary value of 1', () => {
    expect(resolveAnalysisTopN(1)).toBe(1)
  })

  it('accepts boundary value of 500', () => {
    expect(resolveAnalysisTopN(500)).toBe(500)
  })
})
