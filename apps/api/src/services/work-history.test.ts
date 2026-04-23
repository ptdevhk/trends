import { describe, expect, it } from 'vitest'

import {
  computeEntryRoleYears,
  computeWorkHistoryYears,
  extractCompanyFromWorkHistory,
  parseRoleYears,
} from './work-history.js'

import type { ResumeWorkHistoryItem } from './ingest-compute-service.js'

describe('parseRoleYears', () => {
  it('extracts years from a date range string', () => {
    expect(parseRoleYears('2021-03 ~ 2024-01')).toBeCloseTo(2.8, 1)
  })

  it('extracts years from parenthesized duration (N年M月)', () => {
    expect(parseRoleYears('(3年6月)')).toBeCloseTo(3.5, 1)
  })

  it('returns 0 for empty string', () => {
    expect(parseRoleYears('')).toBe(0)
  })

  it('handles 至今 (present) with anchor date', () => {
    const anchor = new Date('2026-04-24')
    expect(parseRoleYears('2024-01 ~ 至今', anchor)).toBeCloseTo(2.3, 1)
  })

  it('extracts years from Chinese year-month format (YYYY年M月)', () => {
    expect(parseRoleYears('2021年3月~2024年1月')).toBeCloseTo(2.8, 1)
  })

  it('extracts years from dot-separated date range', () => {
    expect(parseRoleYears('2021.03 ~ 2024.01')).toBeCloseTo(2.8, 1)
  })

  it('defaults to January when month is omitted after separator', () => {
    // Separator present but no month digit: "YYYY-" defaults month to 1
    expect(parseRoleYears('2021- ~ 2024-')).toBeCloseTo(3, 0)
  })

  it('returns 0 for string with no parseable date info', () => {
    expect(parseRoleYears('销售工程师经历')).toBe(0)
  })

  it('handles present markers: 目前, present, current', () => {
    const anchor = new Date('2026-04-24')
    expect(parseRoleYears('2024-01 ~ 目前', anchor)).toBeCloseTo(2.3, 1)
    expect(parseRoleYears('2024-01 ~ present', anchor)).toBeCloseTo(2.3, 1)
    expect(parseRoleYears('2024-01 ~ current', anchor)).toBeCloseTo(2.3, 1)
  })
})

describe('computeEntryRoleYears', () => {
  it('computes years from structured date range', () => {
    const entry: ResumeWorkHistoryItem = {
      companyName: 'Example Co',
      jobTitle: 'Sales Engineer',
      startDate: '2021-03',
      endDate: '2024-01',
    }
    const result = computeEntryRoleYears(entry)
    expect(result).toBeCloseTo(2.8, 1)
  })

  it('returns 0 when entry has only unstructured raw text', () => {
    const entry: ResumeWorkHistoryItem = {
      raw: '销售工程师经历',
    }
    expect(computeEntryRoleYears(entry)).toBe(0)
  })

  it('returns 0 for empty entry', () => {
    expect(computeEntryRoleYears({})).toBe(0)
  })

  it('falls back to raw text when structured dates are absent', () => {
    const entry: ResumeWorkHistoryItem = {
      raw: '2019-06~2023-12(4年6月)北京精雕科技集团有限公司销售工程师',
    }
    const result = computeEntryRoleYears(entry)
    expect(result).toBeCloseTo(4.5, 0)
  })

  it('resolves raw 至今 pattern with anchorDate', () => {
    const anchor = new Date('2026-04-01')
    const entry: ResumeWorkHistoryItem = {
      raw: '2024-01~至今 苏州美科生贸易有限公司 CNC销售',
    }
    const result = computeEntryRoleYears(entry, anchor)
    expect(result).toBeCloseTo(2.3, 0)
  })

  it('prefers structured date range over raw text', () => {
    const entry: ResumeWorkHistoryItem = {
      companyName: 'A',
      jobTitle: 'Engineer',
      startDate: '2020-01',
      endDate: '2024-01',
      raw: '1990-01~1995-01(5年)旧公司 旧职位',
    }
    // Should use structured 2020-01 ~ 2024-01 = 4 years, not raw 5 years
    const result = computeEntryRoleYears(entry)
    expect(result).toBeCloseTo(4, 0)
  })
})

describe('computeWorkHistoryYears', () => {
  it('returns null for empty array', () => {
    expect(computeWorkHistoryYears([])).toBeNull()
  })

  it('sums years across non-overlapping entries', () => {
    const entries: ResumeWorkHistoryItem[] = [
      { companyName: 'A', jobTitle: 'Engineer', startDate: '2018-01', endDate: '2020-01' },
      { companyName: 'B', jobTitle: 'Sales', startDate: '2021-01', endDate: '2024-01' },
    ]
    const result = computeWorkHistoryYears(entries)
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(5, 0)
  })

  it('merges overlapping date ranges instead of overcounting', () => {
    const entries: ResumeWorkHistoryItem[] = [
      { companyName: 'A', jobTitle: 'Engineer', startDate: '2020-01', endDate: '2024-01' },
      { companyName: 'B', jobTitle: 'Sales', startDate: '2022-01', endDate: '2024-06' },
    ]
    // True span: 2020-01 to 2024-06 = ~4.4 years
    // Naive sum would be 4 + 2.5 = 6.5 years (overcounts ~2 years of overlap)
    const result = computeWorkHistoryYears(entries)
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(4.4, 0)
  })

  it('merges fully nested date ranges', () => {
    const entries: ResumeWorkHistoryItem[] = [
      { companyName: 'A', jobTitle: 'Engineer', startDate: '2018-01', endDate: '2024-01' },
      { companyName: 'B', jobTitle: 'Sales', startDate: '2020-01', endDate: '2022-01' },
    ]
    // B is fully nested inside A; total span is just A = 6 years
    const result = computeWorkHistoryYears(entries)
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(6, 0)
  })

  it('merges adjacent but non-overlapping entries without dedup', () => {
    const entries: ResumeWorkHistoryItem[] = [
      { companyName: 'A', jobTitle: 'Engineer', startDate: '2018-01', endDate: '2020-01' },
      { companyName: 'B', jobTitle: 'Sales', startDate: '2021-01', endDate: '2024-01' },
    ]
    // No overlap: 2 + 3 = 5 years
    const result = computeWorkHistoryYears(entries)
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(5, 0)
  })

  it('returns null when all entries yield zero years', () => {
    const entries: ResumeWorkHistoryItem[] = [
      { raw: 'no duration info' },
    ]
    expect(computeWorkHistoryYears(entries)).toBeNull()
  })

  it('computes single entry correctly', () => {
    const entries: ResumeWorkHistoryItem[] = [
      { companyName: 'A', jobTitle: 'Engineer', startDate: '2020-01', endDate: '2024-01' },
    ]
    const result = computeWorkHistoryYears(entries)
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(4, 0)
  })

  it('resolves 至今 (present) end date against anchorDate', () => {
    const anchor = new Date('2026-04-01')
    const entries: ResumeWorkHistoryItem[] = [
      { companyName: 'A', jobTitle: 'Engineer', startDate: '2023-06', endDate: '至今' },
    ]
    const result = computeWorkHistoryYears(entries, anchor)
    expect(result).not.toBeNull()
    // 2023-06 to 2026-04 = ~2.8 years
    expect(result!).toBeCloseTo(2.8, 0)
  })

  it('treats missing endDate as ongoing via anchorDate', () => {
    const anchor = new Date('2026-01-01')
    const entries: ResumeWorkHistoryItem[] = [
      { companyName: 'A', jobTitle: 'Engineer', startDate: '2022-01' },
    ]
    const result = computeWorkHistoryYears(entries, anchor)
    expect(result).not.toBeNull()
    // 2022-01 to 2026-01 = 4 years
    expect(result!).toBeCloseTo(4, 0)
  })

  it('falls back to raw text date parsing when structured dates are absent', () => {
    const entries: ResumeWorkHistoryItem[] = [
      { raw: '2019-06~2023-12(4年6月)北京精雕科技集团有限公司销售工程师' },
    ]
    const result = computeWorkHistoryYears(entries)
    expect(result).not.toBeNull()
    // 2019-06 to 2023-12 = 4.5 years
    expect(result!).toBeCloseTo(4.5, 0)
  })

  it('merges 3+ overlapping intervals correctly', () => {
    const entries: ResumeWorkHistoryItem[] = [
      { companyName: 'A', jobTitle: 'Engineer', startDate: '2018-01', endDate: '2024-01' },
      { companyName: 'B', jobTitle: 'Sales', startDate: '2020-01', endDate: '2023-01' },
      { companyName: 'C', jobTitle: 'Manager', startDate: '2022-01', endDate: '2024-06' },
    ]
    // A spans 2018-01..2024-01; C extends to 2024-06; B is nested inside A
    // Merged: 2018-01 to 2024-06 = 6.5 years
    const result = computeWorkHistoryYears(entries)
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(6.5, 0)
  })

  it('rounds result to one decimal place', () => {
    const entries: ResumeWorkHistoryItem[] = [
      { companyName: 'A', jobTitle: 'Engineer', startDate: '2020-01', endDate: '2020-07' },
    ]
    // 6 months = 0.5 years — already one decimal
    const result = computeWorkHistoryYears(entries)
    expect(result).toBe(0.5)
  })

  it('resolves raw 至今 pattern against anchorDate', () => {
    const anchor = new Date('2026-04-01')
    const entries: ResumeWorkHistoryItem[] = [
      { raw: '2024-01~至今 苏州美科生贸易有限公司 CNC销售' },
    ]
    const result = computeWorkHistoryYears(entries, anchor)
    expect(result).not.toBeNull()
    // 2024-01 to 2026-04 = ~2.3 years
    expect(result!).toBeCloseTo(2.3, 0)
  })
})

describe('extractCompanyFromWorkHistory', () => {
  it('extracts company name from companyName field', () => {
    const entry: ResumeWorkHistoryItem = {
      companyName: '苏州美科生贸易有限公司',
      jobTitle: 'Sales Engineer',
      startDate: '2020-01',
      endDate: '2024-01',
    }
    expect(extractCompanyFromWorkHistory(entry)).toBe('苏州美科生贸易有限公司')
  })

  it('extracts company name from raw text when companyName is absent', () => {
    const entry: ResumeWorkHistoryItem = {
      raw: '2020-01 ~ 2024-01 深圳创世纪机械有限公司 CNC工程师',
    }
    expect(extractCompanyFromWorkHistory(entry)).toContain('创世纪')
  })

  it('returns empty string when no company pattern is found', () => {
    expect(extractCompanyFromWorkHistory({})).toBe('')
  })

  it('extracts company with 集团 suffix', () => {
    const entry: ResumeWorkHistoryItem = {
      raw: '2018-01~2024-01 北京精雕科技集团有限公司 区域经理',
    }
    expect(extractCompanyFromWorkHistory(entry)).toContain('集团')
  })

  it('extracts company with 厂 suffix', () => {
    const entry: ResumeWorkHistoryItem = {
      raw: '2015-03~2019-12 东莞某机械厂 技术员',
    }
    expect(extractCompanyFromWorkHistory(entry)).toContain('厂')
  })

  it('returns first token when no company pattern matches but token exists', () => {
    // 自由职业 doesn't match COMPANY_PATTERN (no 公司/集团/科技/etc suffix)
    // but falls through to first-token heuristic (≥2 chars)
    const entry: ResumeWorkHistoryItem = {
      raw: '2020-01~2024-01 自由职业 销售',
    }
    const result = extractCompanyFromWorkHistory(entry)
    // Falls back to first token ≥2 chars, not empty string
    expect(result.length).toBeGreaterThanOrEqual(2)
  })
})
