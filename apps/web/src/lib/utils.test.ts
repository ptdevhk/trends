import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils'

describe('cn', () => {
  it('joins class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('merges Tailwind classes (last wins)', () => {
    expect(cn('px-4', 'px-2')).toBe('px-2')
  })

  it('handles conditional classes', () => {
    const showHidden = false
    expect(cn('base', showHidden && 'hidden', 'visible')).toBe('base visible')
  })

  it('handles undefined values', () => {
    expect(cn('foo', undefined, 'bar')).toBe('foo bar')
  })

  it('handles null values', () => {
    expect(cn('foo', null, 'bar')).toBe('foo bar')
  })

  it('handles empty inputs', () => {
    expect(cn()).toBe('')
  })

  it('resolves conflicting padding', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2')
  })

  it('resolves color conflicts', () => {
    expect(cn('text-red-500', 'text-blue-700')).toBe('text-blue-700')
  })
})
