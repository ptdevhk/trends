import { describe, expect, it } from 'vitest'

import {
  filterResumesByAgeRange,
  getAgeRangeFromUrl,
  normalizeOptionalPositiveInt,
  parseAgeNumber,
} from '../job51-age-filter'

describe('job51-age-filter', () => {
  it('normalizes optional positive integers', () => {
    expect(normalizeOptionalPositiveInt(' 35 ')).toBe(35)
    expect(normalizeOptionalPositiveInt('0')).toBeNull()
    expect(normalizeOptionalPositiveInt('abc')).toBeNull()
  })

  it('parses numeric age inputs', () => {
    expect(parseAgeNumber(37)).toBe(37)
    expect(parseAgeNumber('37')).toBe(37)
  })

  it('parses age strings with chinese suffixes', () => {
    expect(parseAgeNumber('32岁')).toBe(32)
    expect(parseAgeNumber(' 45 岁 ')).toBe(45)
  })

  it('rejects unsupported age strings', () => {
    expect(parseAgeNumber('unknown')).toBeNull()
    expect(parseAgeNumber('35-40岁')).toBeNull()
    expect(parseAgeNumber('')).toBeNull()
  })

  it('reads age ranges from injected search strings', () => {
    expect(getAgeRangeFromUrl('?tr_min_age=28&tr_max_age=35')).toEqual({
      enabled: true,
      minAge: 28,
      maxAge: 35,
    })
  })

  it('supports custom age range parameter names', () => {
    expect(getAgeRangeFromUrl('?min=30&max=40', 'min', 'max')).toEqual({
      enabled: true,
      minAge: 30,
      maxAge: 40,
    })
  })

  it('treats invalid params as disabled', () => {
    expect(getAgeRangeFromUrl('?tr_min_age=abc&tr_max_age=0')).toEqual({
      enabled: false,
      minAge: undefined,
      maxAge: undefined,
    })
  })

  it('returns the original resumes unchanged when no range is enabled', () => {
    const resumes = [
      { name: 'A', age: '29岁' },
      { name: 'B', age: 'unknown' },
    ]

    expect(filterResumesByAgeRange(resumes, '?keyword=CNC')).toBe(resumes)
  })

  it('filters resumes by a min-only age range', () => {
    expect(
      filterResumesByAgeRange(
        [
          { name: 'A', age: '29岁' },
          { name: 'B', age: '32岁' },
          { name: 'C', age: '36' },
        ],
        '?tr_min_age=32',
      ),
    ).toEqual([
      { name: 'B', age: '32岁' },
      { name: 'C', age: '36' },
    ])
  })

  it('filters resumes by a max-only age range', () => {
    expect(
      filterResumesByAgeRange(
        [
          { name: 'A', age: '29岁' },
          { name: 'B', age: '32岁' },
          { name: 'C', age: '36' },
        ],
        '?tr_max_age=32',
      ),
    ).toEqual([
      { name: 'A', age: '29岁' },
      { name: 'B', age: '32岁' },
    ])
  })

  it('drops unknown ages only when a range is enabled', () => {
    const resumes = [
      { name: 'A', age: '' },
      { name: 'B', age: 'unknown' },
      { name: 'C', age: '32岁' },
    ]

    expect(filterResumesByAgeRange(resumes, '?keyword=CNC')).toEqual(resumes)
    expect(filterResumesByAgeRange(resumes, '?tr_min_age=30&tr_max_age=35')).toEqual([
      { name: 'C', age: '32岁' },
    ])
  })

  it('filters resumes by the injected age range and drops unknown ages when enabled', () => {
    expect(
      filterResumesByAgeRange(
        [
          { name: 'A', age: '29岁' },
          { name: 'B', age: '32岁' },
          { name: 'C', age: '36岁' },
          { name: 'D', age: 'unknown' },
        ],
        '?tr_min_age=30&tr_max_age=35',
      ),
    ).toEqual([{ name: 'B', age: '32岁' }])
  })
})
