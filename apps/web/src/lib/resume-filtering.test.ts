import { describe, expect, it } from 'vitest'
import { parseExperienceYears, getResumeAge } from '@/lib/resume-filtering'

describe('parseExperienceYears', () => {
  it('returns 0 for undefined', () => {
    expect(parseExperienceYears(undefined)).toBe(0)
  })

  it('returns 0 for empty string', () => {
    expect(parseExperienceYears('')).toBe(0)
  })

  it('returns 0 for non-numeric string', () => {
    expect(parseExperienceYears('N/A')).toBe(0)
  })

  it('parses integer years', () => {
    expect(parseExperienceYears('5')).toBe(5)
  })

  it('parses decimal years', () => {
    expect(parseExperienceYears('3.5')).toBe(3.5)
  })

  it('extracts first number from text', () => {
    expect(parseExperienceYears('5 years experience')).toBe(5)
  })

  it('extracts decimal from text', () => {
    expect(parseExperienceYears('3.5 yrs')).toBe(3.5)
  })

  it('parses range and takes first number', () => {
    expect(parseExperienceYears('5-8')).toBe(5)
  })

  it('handles whitespace padding', () => {
    expect(parseExperienceYears('  10  ')).toBe(10)
  })

  it('returns 0 for English zero-experience terms (Seek EN)', () => {
    expect(parseExperienceYears('fresh graduate')).toBe(0)
    expect(parseExperienceYears('entry level')).toBe(0)
    expect(parseExperienceYears('no experience')).toBe(0)
    expect(parseExperienceYears('beginner')).toBe(0)
  })

  it('returns 0 for Chinese zero-experience terms', () => {
    expect(parseExperienceYears('应届')).toBe(0)
    expect(parseExperienceYears('无经验')).toBe(0)
  })
})

describe('getResumeAge', () => {
  it('returns null for empty object', () => {
    expect(getResumeAge({})).toBeNull()
  })

  it('returns null for undefined age', () => {
    expect(getResumeAge({ age: undefined })).toBeNull()
  })

  it('uses ageNumber when available', () => {
    expect(getResumeAge({ ageNumber: 30 })).toBe(30)
  })

  it('truncates ageNumber decimal', () => {
    expect(getResumeAge({ ageNumber: 30.7 })).toBe(30)
  })

  it('parses Chinese age suffix', () => {
    expect(getResumeAge({ age: '25岁' })).toBe(25)
  })

  it('parses plain number string', () => {
    expect(getResumeAge({ age: '30' })).toBe(30)
  })

  it('handles non-numeric age string', () => {
    expect(getResumeAge({ age: 'unknown' })).toBeNull()
  })
})
