import { describe, expect, it } from 'vitest'
import { formatInAppTimezone } from '@/lib/timezone'

describe('formatInAppTimezone', () => {
  const knownDate = new Date('2026-04-15T10:00:00Z')

  // Note: APP_TIMEZONE is resolved at module load time from import.meta.env
  // Default timezone is Asia/Hong_Kong (UTC+8)

  it('returns a formatted time string', () => {
    const result = formatInAppTimezone(knownDate, { includeDate: true })
    // Hong Kong is UTC+8, so 10:00 UTC = 18:00 HKT
    expect(result).toContain('2026-04-15')
  })

  it('includes time in output', () => {
    const result = formatInAppTimezone(knownDate, { includeDate: true })
    // Should contain some hour:minute format
    expect(result).toMatch(/\d{2}:\d{2}/)
  })

  it('omits date by default', () => {
    const result = formatInAppTimezone(knownDate)
    expect(result).not.toContain('2026')
  })

  it('includes seconds when includeSeconds is true', () => {
    const result = formatInAppTimezone(knownDate, { includeDate: true, includeSeconds: true })
    expect(result).toMatch(/:\d{2}$/)
  })

  it('returns empty string for invalid date', () => {
    expect(formatInAppTimezone('not-a-date')).toBe('')
  })

  it('accepts timestamp number', () => {
    const result = formatInAppTimezone(knownDate.getTime(), { includeDate: true })
    expect(result).toContain('2026-04-15')
  })

  it('accepts ISO string', () => {
    const result = formatInAppTimezone('2026-04-15T10:00:00Z', { includeDate: true })
    expect(result).toContain('2026-04-15')
  })
})
