import { describe, expect, it } from 'vitest'

import {
  normalizeIndustryTags,
  normalizeOptionalString,
  generateStructuredJobDescriptionContent,
} from '../job-description-content.js'

describe('normalizeOptionalString', () => {
  it('returns undefined for null', () => {
    expect(normalizeOptionalString(null)).toBeUndefined()
  })

  it('returns undefined for undefined', () => {
    expect(normalizeOptionalString(undefined)).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(normalizeOptionalString('')).toBeUndefined()
  })

  it('returns undefined for whitespace-only string', () => {
    expect(normalizeOptionalString('   ')).toBeUndefined()
  })

  it('returns trimmed string for valid input', () => {
    expect(normalizeOptionalString('  CNC  ')).toBe('CNC')
  })
})

describe('normalizeIndustryTags', () => {
  it('returns empty array for null', () => {
    expect(normalizeIndustryTags(null)).toEqual([])
  })

  it('returns empty array for undefined', () => {
    expect(normalizeIndustryTags(undefined)).toEqual([])
  })

  it('normalizes canonical tags', () => {
    expect(normalizeIndustryTags(['machinery', 'sales'])).toEqual(['machinery', 'sales'])
  })

  it('maps legacy cnc tag to machinery', () => {
    expect(normalizeIndustryTags(['cnc'])).toEqual(['machinery'])
  })

  it('filters out null-mapped legacy tags (automation)', () => {
    expect(normalizeIndustryTags(['automation'])).toEqual([])
  })

  it('filters out unknown tags', () => {
    expect(normalizeIndustryTags(['unknown', 'machinery'])).toEqual(['machinery'])
  })

  it('deduplicates after normalization', () => {
    // cnc → machinery; both cnc and machinery in input → only one machinery
    expect(normalizeIndustryTags(['cnc', 'machinery'])).toEqual(['machinery'])
  })

  it('is case-insensitive (order follows insertion)', () => {
    const result = normalizeIndustryTags(['Sales', 'MACHINERY'])
    expect(result).toContain('machinery')
    expect(result).toContain('sales')
  })
})

describe('generateStructuredJobDescriptionContent', () => {
  it('generates valid YAML frontmatter with title', () => {
    const result = generateStructuredJobDescriptionContent({
      title: 'CNC Sales Engineer',
    })
    expect(result).toContain('title: "CNC Sales Engineer"')
    expect(result).toContain('status: active')
    expect(result).toContain('---')
  })

  it('includes auto_match with keywords', () => {
    const result = generateStructuredJobDescriptionContent({
      title: 'Test',
      customKeywords: ['CNC', '销售'],
    })
    expect(result).toContain('auto_match:')
    expect(result).toContain('keywords:')
    expect(result).toContain('- "CNC"')
    expect(result).toContain('- "销售"')
  })

  it('emits empty keywords when none provided', () => {
    const result = generateStructuredJobDescriptionContent({
      title: 'Test',
    })
    expect(result).toContain('keywords: []')
  })

  it('includes location when provided', () => {
    const result = generateStructuredJobDescriptionContent({
      title: 'Test',
      location: '广东,深圳',
    })
    expect(result).toContain('location: "广东,深圳"')
  })

  it('includes experience range', () => {
    const result = generateStructuredJobDescriptionContent({
      title: 'Test',
      minExperience: 3,
      maxExperience: 8,
    })
    expect(result).toContain('min_experience: 3')
    expect(result).toContain('max_experience: 8')
  })

  it('defaults min_experience to 1 when not provided', () => {
    const result = generateStructuredJobDescriptionContent({
      title: 'Test',
    })
    expect(result).toContain('min_experience: 1')
  })

  it('includes age range when provided', () => {
    const result = generateStructuredJobDescriptionContent({
      title: 'Test',
      minAge: 25,
      maxAge: 40,
    })
    expect(result).toContain('min_age: 25')
    expect(result).toContain('max_age: 40')
  })

  it('includes industry_tags when provided', () => {
    const result = generateStructuredJobDescriptionContent({
      title: 'Test',
      industryTags: ['machinery', 'sales'],
    })
    expect(result).toContain('industry_tags:')
    expect(result).toContain('- "machinery"')
    expect(result).toContain('- "sales"')
  })

  it('generates body content with job description template', () => {
    const result = generateStructuredJobDescriptionContent({
      title: 'CNC Engineer',
    })
    expect(result).toContain('# 职位描述')
    expect(result).toContain('请补充「CNC Engineer」的岗位职责。')
    expect(result).toContain('# 任职要求')
  })

  it('includes experience in body requirements', () => {
    const result = generateStructuredJobDescriptionContent({
      title: 'Test',
      minExperience: 3,
      maxExperience: 5,
    })
    expect(result).toContain('相关经验：3-5 年')
  })

  it('shows plus sign when no max experience', () => {
    const result = generateStructuredJobDescriptionContent({
      title: 'Test',
      minExperience: 5,
    })
    expect(result).toContain('相关经验：5+ 年')
  })

  it('includes keywords section in body', () => {
    const result = generateStructuredJobDescriptionContent({
      title: 'Test',
      customKeywords: ['CNC', 'sales'],
    })
    expect(result).toContain('# 关键词')
    expect(result).toContain('CNC, sales')
  })
})
