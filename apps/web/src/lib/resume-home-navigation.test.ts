import { describe, expect, it } from 'vitest'
import { RESUME_HOME_RESET_STATE, isResumeHomeResetState } from '@/lib/resume-home-navigation'

describe('RESUME_HOME_RESET_STATE', () => {
  it('has resetResumeSearch set to true', () => {
    expect(RESUME_HOME_RESET_STATE.resetResumeSearch).toBe(true)
  })
})

describe('isResumeHomeResetState', () => {
  it('returns true for valid reset state', () => {
    expect(isResumeHomeResetState({ resetResumeSearch: true })).toBe(true)
  })

  it('returns false for missing property', () => {
    expect(isResumeHomeResetState({})).toBe(false)
  })

  it('returns false for wrong value', () => {
    expect(isResumeHomeResetState({ resetResumeSearch: false })).toBe(false)
  })

  it('returns false for null', () => {
    expect(isResumeHomeResetState(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isResumeHomeResetState(undefined)).toBe(false)
  })

  it('returns false for non-object values', () => {
    expect(isResumeHomeResetState('string')).toBe(false)
    expect(isResumeHomeResetState(42)).toBe(false)
  })
})
