import { describe, expect, it } from 'vitest'
import { parseKeywordQuery, formatKeywordInput, normalizeKeywordPhrases } from './keyword-query'

describe('normalizeKeywordPhrases', () => {
  it('trims and deduplicates keywords', () => {
    expect(normalizeKeywordPhrases([' React ', 'react', ' TypeScript '])).toEqual(['React', 'TypeScript'])
  })

  it('removes empty strings', () => {
    expect(normalizeKeywordPhrases(['React', '', '  '])).toEqual(['React'])
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
})
