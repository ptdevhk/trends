import { describe, expect, it } from 'vitest'
import {
  parseKeywordQuery,
  formatKeywordQuery,
  formatKeywordInput,
  formatQuickStartSearchQuery,
  formatResumeSearchBoxQuery,
  resolveSalesDutyFilters,
  normalizeKeywordPhrases,
  inferKeywordQueryMode,
} from './keyword-query'

describe('normalizeKeywordPhrases', () => {
  it('trims and deduplicates keywords', () => {
    expect(normalizeKeywordPhrases([' React ', 'react', ' TypeScript '])).toEqual(['React', 'TypeScript'])
  })

  it('removes empty strings', () => {
    expect(normalizeKeywordPhrases(['React', '', '  '])).toEqual(['React'])
  })

  it('collapses internal whitespace', () => {
    expect(normalizeKeywordPhrases(['React  Developer'])).toEqual(['React Developer'])
  })

  it('returns empty array for all-empty input', () => {
    expect(normalizeKeywordPhrases(['', '  '])).toEqual([])
  })

  it('preserves case of first occurrence', () => {
    expect(normalizeKeywordPhrases(['REACT', 'react'])).toEqual(['REACT'])
  })
})

describe('inferKeywordQueryMode', () => {
  it('returns AND for single keyword', () => {
    expect(inferKeywordQueryMode(['React'])).toBe('AND')
  })

  it('returns AND for multiple single-word keywords', () => {
    expect(inferKeywordQueryMode(['React', 'TypeScript'])).toBe('AND')
  })

  it('returns OR for multiple keywords with multi-word phrases', () => {
    expect(inferKeywordQueryMode(['React Developer', 'TypeScript'])).toBe('OR')
  })

  it('returns AND for empty array', () => {
    expect(inferKeywordQueryMode([])).toBe('AND')
  })
})

describe('parseKeywordQuery', () => {
  it('parses simple AND query', () => {
    const result = parseKeywordQuery('React TypeScript')
    expect(result.keywords).toEqual(['React', 'TypeScript'])
    expect(result.mode).toBe('AND')
  })

  it('parses quoted AND query', () => {
    const result = parseKeywordQuery('"React" "TypeScript"')
    expect(result.keywords).toEqual(['React', 'TypeScript'])
    expect(result.mode).toBe('AND')
  })

  it('handles mixed quoted and unquoted', () => {
    const result = parseKeywordQuery('"React" TypeScript')
    expect(result.keywords).toContain('React')
    expect(result.keywords).toContain('TypeScript')
  })

  it('handles empty input', () => {
    expect(parseKeywordQuery('').keywords).toEqual([])
  })

  it('handles whitespace-only input', () => {
    expect(parseKeywordQuery('   ').keywords).toEqual([])
  })

  it('parses OR-delimited query with commas', () => {
    const result = parseKeywordQuery('React, TypeScript')
    expect(result.keywords).toEqual(['React', 'TypeScript'])
    expect(result.mode).toBe('AND')
  })

  it('parses OR-delimited multi-word phrases with commas', () => {
    const result = parseKeywordQuery('React Developer, TypeScript Expert')
    expect(result.keywords).toEqual(['React Developer', 'TypeScript Expert'])
    expect(result.mode).toBe('OR')
  })

  it('parses explicit OR keyword', () => {
    const result = parseKeywordQuery('React OR TypeScript')
    expect(result.keywords).toEqual(['React', 'TypeScript'])
    expect(result.mode).toBe('OR')
  })

  it('treats trailing 销售 after an OR pair as sales duty, not a third keyword', () => {
    const result = parseKeywordQuery('三坐标 or 3D扫描 销售')
    expect(result).toEqual({
      keywords: ['三坐标', '3D扫描'],
      mode: 'OR',
      salesDuty: true,
    })
  })

  it('keeps 销售 as an OR alternative when it follows or', () => {
    const result = parseKeywordQuery('三坐标 or 销售')
    expect(result).toEqual({
      keywords: ['三坐标', '销售'],
      mode: 'OR',
    })
  })

  it('does not peel 销售 from AND queries', () => {
    const result = parseKeywordQuery('CNC 销售')
    expect(result).toEqual({
      keywords: ['CNC', '销售'],
      mode: 'AND',
    })
  })

  it('parses newline-delimited keywords', () => {
    const result = parseKeywordQuery('React\nTypeScript')
    expect(result.keywords).toEqual(['React', 'TypeScript'])
  })

  it('handles Chinese comma delimiter', () => {
    const result = parseKeywordQuery('React，TypeScript')
    expect(result.keywords).toEqual(['React', 'TypeScript'])
  })

  it('handles Chinese enumeration comma delimiter', () => {
    const result = parseKeywordQuery('React、TypeScript')
    expect(result.keywords).toEqual(['React', 'TypeScript'])
  })

  it('handles quoted phrase with spaces', () => {
    const result = parseKeywordQuery('"React Developer"')
    expect(result.keywords).toEqual(['React Developer'])
  })

  it('treats backslash as regular character in quoted phrase', () => {
    // tokenizer does not support backslash-escaped quotes; backslash is literal
    const result = parseKeywordQuery('"say hello"')
    expect(result.keywords).toEqual(['say hello'])
  })

  it('deduplicates parsed keywords', () => {
    const result = parseKeywordQuery('React React')
    expect(result.keywords).toEqual(['React'])
  })
})

describe('formatKeywordQuery', () => {
  it('formats AND keywords as space-separated', () => {
    expect(formatKeywordQuery(['React', 'TypeScript'])).toBe('React TypeScript')
  })

  it('formats OR keywords as quoted phrases with OR', () => {
    expect(formatKeywordQuery(['React', 'TypeScript'], 'OR')).toBe('"React" OR "TypeScript"')
  })

  it('quotes multi-word phrases in AND mode', () => {
    expect(formatKeywordQuery(['React Developer'])).toBe('"React Developer"')
  })

  it('returns empty string for empty keywords', () => {
    expect(formatKeywordQuery([])).toBe('')
  })

  it('formats single keyword', () => {
    expect(formatKeywordQuery(['React'])).toBe('React')
  })
})

describe('formatResumeSearchBoxQuery', () => {
  it('formats CJK OR plus sales duty the way users type it', () => {
    expect(formatResumeSearchBoxQuery({
      keywords: ['三坐标', '3D扫描'],
      mode: 'OR',
      salesDuty: true,
    })).toBe('三坐标 or 3D扫描 销售')
  })
})

describe('formatQuickStartSearchQuery', () => {
  it('keeps CNC 销售 as AND', () => {
    expect(formatQuickStartSearchQuery({
      keywords: ['CNC', '销售'],
      roleFilterType: 'sales',
    })).toBe('CNC 销售')
  })

  it('turns 三坐标+3D扫描 sales profiles into or plus sales duty', () => {
    expect(formatQuickStartSearchQuery({
      keywords: ['三坐标', '3D扫描', '销售'],
      roleFilterType: 'sales',
    })).toBe('三坐标 or 3D扫描 销售')
  })
})

describe('resolveSalesDutyFilters', () => {
  it('fills sales years when the query implies sales duty', () => {
    expect(resolveSalesDutyFilters({
      keywords: ['三坐标', '3D扫描'],
      mode: 'OR',
      salesDuty: true,
    })).toEqual({
      roleFilterType: 'sales',
      minRoleYears: 1,
    })
  })
})

describe('formatKeywordInput', () => {
  it('formats single keyword', () => {
    expect(formatKeywordInput(['React'])).toBe('React')
  })

  it('formats multiple OR keywords', () => {
    const result = formatKeywordInput(['React', 'TypeScript'])
    expect(result).toContain('React')
    expect(result).toContain('TypeScript')
  })

  it('quotes single multi-word phrase', () => {
    expect(formatKeywordInput(['React Developer'])).toBe('"React Developer"')
  })

  it('returns empty string for empty input', () => {
    expect(formatKeywordInput([])).toBe('')
  })

  it('formats AND mode keywords as space-separated', () => {
    expect(formatKeywordInput(['React', 'TypeScript'])).toBe('React TypeScript')
  })
})
