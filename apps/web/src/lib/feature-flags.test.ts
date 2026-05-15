import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  isReviewPacketsEnabled,
  isResumeAiSummaryEnabled,
  isHeadlessCollectorEnabled,
} from '@/lib/feature-flags'

describe('feature-flags', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('isReviewPacketsEnabled returns false by default', () => {
    expect(isReviewPacketsEnabled()).toBe(false)
  })

  it('isReviewPacketsEnabled returns true when VITE_ENABLE_REVIEW_PACKETS=true', () => {
    vi.stubEnv('VITE_ENABLE_REVIEW_PACKETS', 'true')
    expect(isReviewPacketsEnabled()).toBe(true)
  })

  it('isResumeAiSummaryEnabled returns false by default', () => {
    expect(isResumeAiSummaryEnabled()).toBe(false)
  })

  it('isResumeAiSummaryEnabled returns true when VITE_ENABLE_RESUME_AI_SUMMARY=true', () => {
    vi.stubEnv('VITE_ENABLE_RESUME_AI_SUMMARY', 'true')
    expect(isResumeAiSummaryEnabled()).toBe(true)
  })

  it('isHeadlessCollectorEnabled returns false by default', () => {
    expect(isHeadlessCollectorEnabled()).toBe(false)
  })

  it('isHeadlessCollectorEnabled returns true when VITE_ENABLE_HEADLESS_COLLECTOR=true', () => {
    vi.stubEnv('VITE_ENABLE_HEADLESS_COLLECTOR', 'true')
    expect(isHeadlessCollectorEnabled()).toBe(true)
  })
})
