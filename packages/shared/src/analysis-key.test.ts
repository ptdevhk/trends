import { describe, expect, it } from 'vitest'
import {
  isSalesRequiredContext,
  getCurrentResumeAiPromptVersion,
} from './analysis-key'

describe('isSalesRequiredContext', () => {
  it('detects English sales keyword', () => {
    expect(isSalesRequiredContext('Worked as sales engineer')).toBe(true)
  })

  it('detects Chinese sales keyword', () => {
    expect(isSalesRequiredContext('担任销售工程师')).toBe(true)
  })

  it('detects BD keyword', () => {
    expect(isSalesRequiredContext('business development manager')).toBe(true)
  })

  it('returns false for unrelated text', () => {
    expect(isSalesRequiredContext('Software engineer at Google')).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isSalesRequiredContext(undefined)).toBe(false)
  })

  it('detects across multiple text arguments', () => {
    expect(isSalesRequiredContext('Software engineer', 'Sales manager')).toBe(true)
  })

  it('handles empty inputs', () => {
    expect(isSalesRequiredContext()).toBe(false)
  })

  it('detects account manager', () => {
    expect(isSalesRequiredContext('Account Manager')).toBe(true)
  })

  it('detects channel sales', () => {
    expect(isSalesRequiredContext('Channel Sales Manager')).toBe(true)
  })
})

describe('getCurrentResumeAiPromptVersion', () => {
  it('returns a positive number', () => {
    const version = getCurrentResumeAiPromptVersion()
    expect(typeof version).toBe('number')
    expect(version).toBeGreaterThan(0)
  })
})
