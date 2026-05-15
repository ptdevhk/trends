import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { highlightTerms } from '@/lib/highlight'

function renderHighlight(text: string | null | undefined, terms: string[]) {
  const { container } = render(<>{highlightTerms(text, terms)}</>)
  return container
}

describe('highlightTerms', () => {
  it('returns null for null text', () => {
    expect(highlightTerms(null, ['term'])).toBeNull()
  })

  it('returns null for undefined text', () => {
    expect(highlightTerms(undefined, ['term'])).toBeNull()
  })

  it('returns text when terms is empty', () => {
    expect(highlightTerms('hello world', [])).toBe('hello world')
  })

  it('returns text when no terms match', () => {
    expect(highlightTerms('hello world', ['zzz'])).toBe('hello world')
  })

  it('wraps matching term in mark tag', () => {
    const container = renderHighlight('hello world', ['world'])
    const mark = container.querySelector('mark')
    expect(mark).toBeTruthy()
    expect(mark?.textContent).toBe('world')
  })

  it('matches case-insensitively', () => {
    const container = renderHighlight('Hello World', ['world'])
    expect(container.querySelector('mark')?.textContent).toBe('World')
  })

  it('highlights first matching term when multiple terms', () => {
    const container = renderHighlight('React TypeScript', ['TypeScript', 'React'])
    const marks = container.querySelectorAll('mark')
    expect(marks.length).toBe(2)
  })

  it('handles special regex characters in terms', () => {
    const container = renderHighlight('cost is $10.00', ['$10.00'])
    expect(container.querySelector('mark')?.textContent).toBe('$10.00')
  })

  it('filters out empty term strings', () => {
    expect(highlightTerms('hello world', ['', '  '])).toBe('hello world')
  })

  it('wraps only the matching portion of text', () => {
    const container = renderHighlight('find the needle in the haystack', ['needle'])
    const mark = container.querySelector('mark')
    expect(mark?.textContent).toBe('needle')
    expect(container.textContent).toContain('find the ')
    expect(container.textContent).toContain(' in the haystack')
  })
})
