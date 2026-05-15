import { describe, expect, it } from 'vitest'
import { resolveResumeId } from './resume-id'

describe('resolveResumeId', () => {
  it('uses resumeId when available', () => {
    expect(resolveResumeId({ resumeId: 'r-123' }, 0)).toBe('r-123')
  })

  it('falls back to perUserId', () => {
    expect(resolveResumeId({ perUserId: 'u-456' }, 0)).toBe('u-456')
  })

  it('falls back to profileId', () => {
    expect(resolveResumeId({ profileId: 'p-789' }, 0)).toBe('p-789')
  })

  it('falls back to externalId', () => {
    expect(resolveResumeId({ externalId: 'ext-001' }, 0)).toBe('ext-001')
  })

  it('falls back to profileUrl', () => {
    expect(resolveResumeId({ profileUrl: 'https://example.com/resume' }, 0)).toBe('https://example.com/resume')
  })

  it('ignores javascript:; profileUrl', () => {
    const result = resolveResumeId({ profileUrl: 'javascript:;', extractedAt: '2026-01-01', name: 'John' }, 0)
    expect(result).toBe('John-2026-01-01')
  })

  it('falls back to name+extractedAt', () => {
    expect(resolveResumeId({ extractedAt: '2026-01-01', name: 'John' }, 0)).toBe('John-2026-01-01')
  })

  it('falls back to name+index', () => {
    expect(resolveResumeId({ name: 'John' }, 5)).toBe('John-5')
  })

  it('uses resume- prefix when name is missing', () => {
    expect(resolveResumeId({}, 3)).toBe('resume-3')
  })

  it('prioritizes resumeId over all others', () => {
    expect(resolveResumeId({
      resumeId: 'r-1', perUserId: 'u-1', profileId: 'p-1',
      externalId: 'ext-1', profileUrl: 'url', extractedAt: 't', name: 'n',
    }, 0)).toBe('r-1')
  })
})
