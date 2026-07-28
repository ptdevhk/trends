import { describe, expect, it } from 'vitest'
import {
  normalizeWorkHistoryEntry,
  buildWorkHistoryDateRange,
  buildWorkHistoryEntryText,
  buildWorkHistoryDisplayDateLine,
  buildWorkHistoryDisplayText,
  extractWorkHistoryDateLineFromRaw,
  extractWorkHistoryDurationFromRaw,
} from './work-history-evidence'

describe('normalizeWorkHistoryEntry', () => {
  it('normalizes string entry', () => {
    const result = normalizeWorkHistoryEntry('  Software Engineer at Google  ')
    expect(result?.raw).toBe('Software Engineer at Google')
  })

  it('returns null for empty string', () => {
    expect(normalizeWorkHistoryEntry('')).toBeNull()
  })

  it('returns null for null', () => {
    expect(normalizeWorkHistoryEntry(null)).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(normalizeWorkHistoryEntry(undefined)).toBeNull()
  })

  it('extracts fields from record', () => {
    const result = normalizeWorkHistoryEntry({
      companyName: '  Google  ',
      jobTitle: 'Engineer',
      description: 'Built things',
      startDate: '2020-01',
      endDate: '2023-12',
    })
    expect(result?.companyName).toBe('Google')
    expect(result?.jobTitle).toBe('Engineer')
    expect(result?.description).toBe('Built things')
    expect(result?.startDate).toBe('2020-01')
    expect(result?.endDate).toBe('2023-12')
  })

  it('returns null when all fields are empty', () => {
    expect(normalizeWorkHistoryEntry({ raw: '', companyName: '' })).toBeNull()
  })

  it('normalizes whitespace in all fields', () => {
    const result = normalizeWorkHistoryEntry({
      companyName: '  Google  ',
      jobTitle: '  Senior  Engineer  ',
    })
    expect(result?.companyName).toBe('Google')
    expect(result?.jobTitle).toBe('Senior Engineer')
  })
})

describe('buildWorkHistoryDateRange', () => {
  it('formats both dates with tilde', () => {
    expect(buildWorkHistoryDateRange('2020-01', '2023-12')).toBe('2020-01 ~ 2023-12')
  })

  it('returns only start date when end is missing', () => {
    expect(buildWorkHistoryDateRange('2020-01', undefined)).toBe('2020-01')
  })

  it('returns only end date when start is missing', () => {
    expect(buildWorkHistoryDateRange(undefined, '2023-12')).toBe('2023-12')
  })

  it('returns empty string when both dates missing', () => {
    expect(buildWorkHistoryDateRange(undefined, undefined)).toBe('')
  })

  it('trims whitespace from dates', () => {
    expect(buildWorkHistoryDateRange('  2020-01  ', '  2023-12  ')).toBe('2020-01 ~ 2023-12')
  })
})

describe('buildWorkHistoryEntryText', () => {
  it('builds structured text from entry', () => {
    const text = buildWorkHistoryEntryText({
      companyName: 'Google',
      jobTitle: 'Engineer',
      description: 'Built things',
      startDate: '2020-01',
      endDate: '2023-12',
    })
    expect(text).toContain('Google')
    expect(text).toContain('Engineer')
    expect(text).toContain('Built things')
  })

  it('falls back to raw text when no structured fields', () => {
    const text = buildWorkHistoryEntryText('Worked at Google')
    expect(text).toBe('Worked at Google')
  })

  it('returns empty string for null entry', () => {
    expect(buildWorkHistoryEntryText(null)).toBe('')
  })

  it('handles partial fields', () => {
    const text = buildWorkHistoryEntryText({ companyName: 'Google' })
    expect(text).toBe('Google')
  })
})

describe('raw work-history date helpers', () => {
  it('extracts Seek month-year date ranges from raw work history', () => {
    const raw = 'Sales Manager · TERRAN LLC. · Jul 2012 - Present (14 years 4 months)'
    expect(extractWorkHistoryDateLineFromRaw(raw)).toBe('Jul 2012 - Present (14 years 4 months)')
    expect(extractWorkHistoryDurationFromRaw(raw)).toBe('14 years 4 months')
  })

  it('extracts numeric date ranges from raw work history', () => {
    const raw = '2019.04 - 至今（6年11个月） 东莞宝力机械 销售经理 负责机床销售与客户维护'
    expect(extractWorkHistoryDateLineFromRaw(raw)).toBe('2019.04 - 至今（6年11个月）')
    expect(extractWorkHistoryDurationFromRaw(raw)).toBe('6年11个月')
  })
})

describe('buildWorkHistoryDisplayDateLine', () => {
  it('uses structured dates and appends raw duration when present', () => {
    const line = buildWorkHistoryDisplayDateLine({
      raw: '2019-04 ~ 至今 (6年11个月) 东莞宝力机械 销售经理',
      startDate: '2019-04',
      endDate: '至今',
    })
    expect(line).toBe('2019-04 ~ 至今 (6年11个月)')
  })

  it('falls back to raw date labels when structured dates are missing', () => {
    const line = buildWorkHistoryDisplayDateLine({
      raw: 'Sales Manager · TERRAN LLC. · Jul 2012 - Present (14 years 4 months)',
      companyName: 'TERRAN LLC.',
      jobTitle: 'Sales Manager',
    })
    expect(line).toBe('Jul 2012 - Present (14 years 4 months)')
  })
})

describe('buildWorkHistoryDisplayText', () => {
  it('keeps raw-only date labels alongside structured fields for display/export', () => {
    const text = buildWorkHistoryDisplayText({
      raw: 'Sales Manager · TERRAN LLC. · Jul 2012 - Present (14 years 4 months)',
      companyName: 'TERRAN LLC.',
      jobTitle: 'Sales Manager',
      description: 'Leads orthopedics implant sales.',
    })
    expect(text).toContain('Jul 2012 - Present (14 years 4 months)')
    expect(text).toContain('TERRAN LLC.')
    expect(text).toContain('Sales Manager')
    expect(text).toContain('Leads orthopedics implant sales.')
  })
})
