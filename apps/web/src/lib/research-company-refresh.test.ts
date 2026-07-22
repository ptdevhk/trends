import { describe, expect, it } from 'vitest'
import {
  isCompanyOnOpenRefreshEnabled,
  shouldAutoRefreshCompany,
  RESEARCH_COMPANY_REFRESH_COOLDOWN_MS,
} from './research-company-refresh'

describe('research-company-refresh', () => {
  it('disabled when flag off', () => {
    expect(
      shouldAutoRefreshCompany({
        enabled: false,
        companyKey: 'fanuc',
        now: 1000,
        lastRefreshAt: null,
      }),
    ).toBe(false)
  })

  it('enabled when no prior refresh', () => {
    expect(
      shouldAutoRefreshCompany({
        enabled: true,
        companyKey: 'fanuc',
        now: 1000,
        lastRefreshAt: null,
      }),
    ).toBe(true)
  })

  it('respects cooldown window', () => {
    const now = 10_000
    expect(
      shouldAutoRefreshCompany({
        enabled: true,
        companyKey: 'fanuc',
        now,
        lastRefreshAt: now - RESEARCH_COMPANY_REFRESH_COOLDOWN_MS + 1,
      }),
    ).toBe(false)
    expect(
      shouldAutoRefreshCompany({
        enabled: true,
        companyKey: 'fanuc',
        now,
        lastRefreshAt: now - RESEARCH_COMPANY_REFRESH_COOLDOWN_MS,
      }),
    ).toBe(true)
  })

  it('parses env flag values', () => {
    expect(isCompanyOnOpenRefreshEnabled({ VITE_RESEARCH_COMPANY_ON_OPEN_REFRESH: '1' })).toBe(true)
    expect(isCompanyOnOpenRefreshEnabled({ VITE_RESEARCH_COMPANY_ON_OPEN_REFRESH: 'true' })).toBe(
      true,
    )
    expect(isCompanyOnOpenRefreshEnabled({ VITE_RESEARCH_COMPANY_ON_OPEN_REFRESH: '0' })).toBe(
      false,
    )
    expect(isCompanyOnOpenRefreshEnabled({})).toBe(false)
  })
})
