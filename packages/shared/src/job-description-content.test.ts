import { describe, expect, it } from 'vitest'
import {
  normalizeOptionalString,
  normalizeIndustryTags,
  INDUSTRY_DISPLAY_NAME_TO_TAG,
  generateStructuredJobDescriptionContent,
  CANONICAL_INDUSTRY_TAGS,
  DEFAULT_MIN_EXPERIENCE,
} from './job-description-content'

describe('INDUSTRY_DISPLAY_NAME_TO_TAG', () => {
  it('maps Chinese machinery to machinery', () => {
    expect(INDUSTRY_DISPLAY_NAME_TO_TAG['机械']).toBe('machinery')
  })
  it('maps Chinese sales to sales', () => {
    expect(INDUSTRY_DISPLAY_NAME_TO_TAG['销售']).toBe('sales')
  })
  it('maps Chinese metrology to metrology', () => {
    expect(INDUSTRY_DISPLAY_NAME_TO_TAG['测量']).toBe('metrology')
  })
  it('maps Chinese software to software', () => {
    expect(INDUSTRY_DISPLAY_NAME_TO_TAG['软件']).toBe('software')
  })
})

describe('CANONICAL_INDUSTRY_TAGS', () => {
  it('has 4 tags', () => {
    expect(CANONICAL_INDUSTRY_TAGS).toEqual(['machinery', 'sales', 'metrology', 'software'])
  })
})

describe('normalizeOptionalString', () => {
  it('trims whitespace', () => {
    expect(normalizeOptionalString('  hello  ')).toBe('hello')
  })
  it('returns undefined for null', () => {
    expect(normalizeOptionalString(null)).toBeUndefined()
  })
  it('returns undefined for undefined', () => {
    expect(normalizeOptionalString(undefined)).toBeUndefined()
  })
  it('returns undefined for empty string', () => {
    expect(normalizeOptionalString('')).toBeUndefined()
  })
  it('returns undefined for whitespace-only', () => {
    expect(normalizeOptionalString('   ')).toBeUndefined()
  })
  it('passes through valid string', () => {
    expect(normalizeOptionalString('Shanghai')).toBe('Shanghai')
  })
})

describe('normalizeIndustryTags', () => {
  it('passes through canonical tags', () => {
    expect(normalizeIndustryTags(['machinery', 'software'])).toEqual(['machinery', 'software'])
  })
  it('resolves legacy cnc tag to machinery', () => {
    expect(normalizeIndustryTags(['cnc'])).toEqual(['machinery'])
  })
  it('filters out null legacy mapping (automation)', () => {
    expect(normalizeIndustryTags(['automation'])).toEqual([])
  })
  it('filters out non-canonical tags', () => {
    expect(normalizeIndustryTags(['machinery', 'nonexistent'])).toEqual(['machinery'])
  })
  it('deduplicates tags', () => {
    expect(normalizeIndustryTags(['machinery', 'machinery'])).toEqual(['machinery'])
  })
  it('handles undefined input', () => {
    expect(normalizeIndustryTags(undefined)).toEqual([])
  })
  it('handles null input', () => {
    expect(normalizeIndustryTags(null)).toEqual([])
  })
  it('does case-insensitive resolution', () => {
    expect(normalizeIndustryTags(['Machinery'])).toEqual(['machinery'])
  })
})

describe('generateStructuredJobDescriptionContent', () => {
  it('generates YAML with title', () => {
    const result = generateStructuredJobDescriptionContent({ title: 'Frontend Engineer' })
    expect(result).toContain('title: "Frontend Engineer"')
    expect(result).toContain('status: active')
  })

  it('includes default min_experience', () => {
    const result = generateStructuredJobDescriptionContent({ title: 'Engineer' })
    expect(result).toContain(`min_experience: ${DEFAULT_MIN_EXPERIENCE}`)
  })

  it('includes location when provided', () => {
    const result = generateStructuredJobDescriptionContent({ title: 'Engineer', location: 'Shanghai' })
    expect(result).toContain('location: "Shanghai"')
  })

  it('includes max_experience when provided', () => {
    const result = generateStructuredJobDescriptionContent({ title: 'Engineer', minExperience: 3, maxExperience: 8 })
    expect(result).toContain('max_experience: 8')
  })

  it('omits max_experience when not provided', () => {
    const result = generateStructuredJobDescriptionContent({ title: 'Engineer', minExperience: 3 })
    expect(result).not.toContain('max_experience')
  })

  it('includes industry_tags when provided', () => {
    const result = generateStructuredJobDescriptionContent({ title: 'Engineer', industryTags: ['machinery'] })
    expect(result).toContain('machinery')
  })

  it('includes min_age and max_age when provided', () => {
    const result = generateStructuredJobDescriptionContent({ title: 'Engineer', minAge: 25, maxAge: 45 })
    expect(result).toContain('min_age: 25')
    expect(result).toContain('max_age: 45')
  })
})
