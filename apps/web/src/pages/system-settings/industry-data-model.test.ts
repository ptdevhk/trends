import { describe, expect, it } from 'vitest'

import { entryLabel, formatTime, type IndustryDataEntry } from './industry-data-model'

function entry(data: unknown): IndustryDataEntry {
  return { entryType: 'brand', entryId: 'brand-1', data }
}

describe('entryLabel', () => {
  it('prefers nameCn on record data', () => {
    expect(entryLabel(entry({ nameCn: '发那科', nameEn: 'FANUC' }))).toBe('发那科')
  })

  it('falls back to keyword and url fields', () => {
    expect(entryLabel(entry({ keyword: 'cnc' }))).toBe('cnc')
    expect(entryLabel(entry({ url: 'https://example.com' }))).toBe('https://example.com')
  })

  it('falls back to a plain string or the entryId', () => {
    expect(entryLabel(entry('direct-string'))).toBe('direct-string')
    expect(entryLabel(entry({ nameEn: 'no cn label' }))).toBe('brand-1')
    expect(entryLabel(entry(null))).toBe('brand-1')
  })
})

describe('formatTime', () => {
  it('renders a dash for missing values', () => {
    expect(formatTime(undefined)).toBe('—')
    expect(formatTime(Number.NaN)).toBe('—')
  })

  it('formats a valid epoch with medium date and short time', () => {
    const value = new Date(2026, 5, 15, 9, 30).getTime()
    expect(formatTime(value)).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)),
    )
  })
})
