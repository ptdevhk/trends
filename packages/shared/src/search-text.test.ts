import { describe, expect, it } from 'vitest'
import { addScriptBoundarySpaces, normalizeSearchQuery, normalizeWhitespace } from './search-text'

describe('normalizeSearchQuery', () => {
  it('boundary-spaces CJK-ASCII joins and lowercases', () => {
    expect(normalizeSearchQuery('CNC编程')).toBe('cnc 编程')
  })

  it('splits multiple CJK-ASCII boundaries', () => {
    expect(normalizeSearchQuery('UG编程 师傅')).toBe('ug 编程 师傅')
  })

  it('normalizes whitespace around CJK-only queries', () => {
    expect(normalizeSearchQuery('  数控车床  ')).toBe('数控车床')
  })

  it('keeps mixed-case ASCII words lowercase', () => {
    expect(normalizeSearchQuery('Mastercam 销售')).toBe('mastercam 销售')
  })

  it('boundary-spaces a fully-joined query', () => {
    expect(normalizeSearchQuery('CNC机床销售Sales')).toBe('cnc 机床销售 sales')
  })
})

describe('addScriptBoundarySpaces', () => {
  it('leaves CJK-only text unchanged', () => {
    expect(addScriptBoundarySpaces('数控车床')).toBe('数控车床')
  })

  it('leaves ASCII-only text unchanged', () => {
    expect(addScriptBoundarySpaces('mastercam cnc')).toBe('mastercam cnc')
  })
})

describe('normalizeWhitespace', () => {
  it('collapses runs of whitespace and trims', () => {
    expect(normalizeWhitespace('  a   b\t\n c ')).toBe('a b c')
  })
})
