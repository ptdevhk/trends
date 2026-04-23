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
})
