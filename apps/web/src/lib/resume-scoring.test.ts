import { describe, expect, it } from 'vitest'
import {
  buildLearningObservation,
  buildResumeKey,
  buildRuleScoringText,
  computeDirectIndustryDb,
  computeNormalizedIndustryDbScore,
  getPrecomputedRuleScore,
  hasIngestData,
  isAutoFilteredAnalysis,
  overrideIndustryDbBreakdown,
  toIndustryDbV2Stats,
  toMatchBreakdown,
  toRecommendation,
} from '@/lib/resume-scoring'

type TestResume = {
  name: string
  profileUrl: string
  activityStatus: string
  age: string
  experience: string
  education: string
  location: string
  selfIntro: string
  jobIntention: string
  expectedSalary: string
  workHistory: Array<{
    raw: string
    companyName?: string
    jobTitle?: string
    description?: string
    startDate?: string
    endDate?: string
  }>
  extractedAt: string
  resumeId?: string
  perUserId?: string
  profileId?: string
  externalId?: string
  ingestData?: {
    evidenceText?: string
    industryTags: string[]
    synonymHits: string[]
    companyHits: string[]
    ruleScores: Record<string, number>
    experienceLevel: string
    computedAt: number
    skillsVersion: number
  }
}

function createResume(partial: Partial<TestResume> = {}): TestResume {
  return {
    name: 'Alice',
    profileUrl: '',
    activityStatus: '',
    age: '',
    experience: '',
    education: '',
    location: '',
    selfIntro: '',
    jobIntention: '',
    expectedSalary: '',
    workHistory: [],
    extractedAt: '',
    resumeId: 'resume-1',
    ...partial,
  }
}

describe('resume-scoring', () => {
  it('falls back recommendation to potential', () => {
    expect(toRecommendation('match')).toBe('match')
    expect(toRecommendation('unknown')).toBe('potential')
  })

  it('passes through valid breakdown with AI prompt keys', () => {
    const breakdown = toMatchBreakdown({
      experience: 10,
      skills: 5,
      industry_db: 5,
      education: 5,
      location: 5,
    })

    expect(breakdown).toEqual({
      experience: 10,
      skills: 5,
      industry_db: 5,
      education: 5,
      location: 5,
    })
  })

  it('passes through legacy camelCase breakdown keys', () => {
    expect(
      toMatchBreakdown({
        skillMatch: 80,
        experienceMatch: 70,
        educationMatch: 90,
        locationMatch: 60,
        industryMatch: 50,
      })
    ).toEqual({
      skillMatch: 80,
      experienceMatch: 70,
      educationMatch: 90,
      locationMatch: 60,
      industryMatch: 50,
    })
  })

  it('returns undefined for empty breakdown', () => {
    expect(toMatchBreakdown({})).toBeUndefined()
    expect(toMatchBreakdown(undefined)).toBeUndefined()
  })

  it('matches the API resume id fallback order for resume keys', () => {
    expect(buildResumeKey(createResume({ resumeId: 'r-1', perUserId: 'u-1', profileUrl: 'https://a.com' }), 0)).toBe('r-1')
    expect(buildResumeKey(createResume({ resumeId: undefined, perUserId: 'u-1', profileUrl: 'https://a.com' }), 0)).toBe('u-1')
    expect(buildResumeKey(createResume({ resumeId: undefined, perUserId: undefined, profileId: 'p-1', profileUrl: 'https://a.com' }), 0)).toBe('p-1')
    expect(buildResumeKey(createResume({ resumeId: undefined, perUserId: undefined, profileId: undefined, externalId: 'ext-1', profileUrl: 'https://a.com' }), 0)).toBe('ext-1')
    expect(buildResumeKey(createResume({ resumeId: undefined, perUserId: undefined, profileUrl: 'https://a.com' }), 0)).toBe('https://a.com')
    expect(buildResumeKey(createResume({ resumeId: undefined, perUserId: undefined, profileUrl: '', extractedAt: '2026-03-01T00:00:00.000Z', name: 'Alice' }), 0)).toBe('Alice-2026-03-01T00:00:00.000Z')
  })

  it('reads precomputed rule score from ingest data', () => {
    const score = getPrecomputedRuleScore(
      createResume({
        ingestData: {
          evidenceText: 'sales engineer cnc lathe',
          industryTags: [],
          synonymHits: [],
          companyHits: [],
          ruleScores: { 'jd-a': 88 },
          experienceLevel: 'mid',
          computedAt: Date.now(),
          skillsVersion: 3,
        },
      }),
      'jd-a'
    )
    expect(score).toBe(88)
  })

  it('detects ingest data and builds learning observation', () => {
    const resume = createResume({
      ingestData: {
        evidenceText: 'lathe operator evidence',
        industryTags: ['cnc', 'lathe'],
        synonymHits: [],
        companyHits: [],
        ruleScores: {},
        experienceLevel: 'senior',
        computedAt: Date.now(),
        skillsVersion: 2,
      },
    })

    expect(hasIngestData(resume)).toBe(true)
    if (hasIngestData(resume)) {
      expect(buildLearningObservation('shortlist', resume)).toBe('shortlist_pattern: cnc + lathe + senior -> high_priority')
    }
  })

  it('builds rule scoring text from structured work history entries', () => {
    const resume = createResume({
      workHistory: [
        {
          raw: '2021-03 ~ 2023-08 Example Co. Sales Engineer',
        },
        {
          raw: 'legacy fallback line',
          companyName: 'Precision Works',
          jobTitle: 'CNC Sales',
          startDate: '2019-01',
          endDate: '2021-02',
        },
      ],
    })

    expect(buildRuleScoringText(resume)).toContain('Precision Works CNC Sales')
    expect(buildRuleScoringText(resume)).toContain('2019-01 ~ 2021-02')
  })

  it('flags auto-filtered analyses', () => {
    expect(
      isAutoFilteredAnalysis({
        score: 10,
        summary: 'Auto-filtered: Low keyword match with JD.',
        highlights: [],
        recommendation: 'no_match',
        breakdown: { keyword_match: 10 },
      })
    ).toBe(true)
  })

  it('normalizes industry_db score from frozen cohort stats', () => {
    expect(computeNormalizedIndustryDbScore(20, {
      size: 50,
      p80: 20,
      histogram50: Array.from({ length: 51 }, (_, index) => (index === 20 ? 50 : 0)),
    })).toBe(40)
  })

  it('parses enriched industry_db cohort stats without dropping legacy fields', () => {
    expect(toIndustryDbV2Stats({
      size: 50,
      min: 0,
      max: 25,
      p50: 10,
      p80: 20,
      mean: 12.4,
      stddev: 6.8,
      histogram50: Array.from({ length: 51 }, (_, index) => (index === 20 ? 50 : 0)),
    })).toEqual({
      size: 50,
      min: 0,
      max: 25,
      p50: 10,
      p80: 20,
      mean: 12.4,
      stddev: 6.8,
      histogram50: Array.from({ length: 51 }, (_, index) => (index === 20 ? 50 : 0)),
    })
  })

  it('adds percentile bonus when industry_db raw score exceeds cohort p80', () => {
    expect(computeNormalizedIndustryDbScore(25, {
      size: 50,
      p80: 20,
      histogram50: Array.from({ length: 51 }, (_, index) => {
        if (index === 20) return 40
        if (index === 25) return 10
        return 0
      }),
    })).toBe(45)
  })

  it('falls back to raw industry_db score for weak cohorts', () => {
    expect(computeNormalizedIndustryDbScore(12, {
      size: 10,
      p80: 4,
      histogram50: Array.from({ length: 51 }, () => 0),
    })).toBe(12)
  })

  it('falls back when non-zero sample count is below minimum threshold', () => {
    expect(computeNormalizedIndustryDbScore(25, {
      size: 50,
      p80: 25,
      histogram50: Array.from({ length: 51 }, (_, index) => (index === 25 ? 3 : 0)),
    })).toBe(25)
  })

  it.each([
    { label: 'returns full slot for brand hits', raw: 10, hasBrandHits: true, hasCompanyHits: false, expected: 50 },
    { label: 'returns full slot for company hits', raw: 10, hasBrandHits: false, hasCompanyHits: true, expected: 50 },
    { label: 'returns full slot for brand and company hits', raw: 10, hasBrandHits: true, hasCompanyHits: true, expected: 50 },
    { label: 'keeps raw score with no hits', raw: 20, hasBrandHits: false, hasCompanyHits: false, expected: 20 },
    { label: 'clamps raw score above cap with no hits', raw: 60, hasBrandHits: false, hasCompanyHits: false, expected: 50 },
    { label: 'defaults missing raw to 0 with no hits', raw: undefined, hasBrandHits: false, hasCompanyHits: false, expected: 0 },
  ])('$label', ({ raw, hasBrandHits, hasCompanyHits, expected }) => {
    expect(computeDirectIndustryDb(raw, hasBrandHits, hasCompanyHits)).toBe(expected)
  })

  it('overrides AI breakdown and recomputes total score', () => {
    expect(overrideIndustryDbBreakdown({
      score: 45,
      summary: 'Good match',
      highlights: [],
      recommendation: 'match',
      breakdown: {
        related_exp: 30,
        industry_db: 15,
      },
    }, 40)).toEqual(expect.objectContaining({
      score: 55,
      breakdown: {
        related_exp: 15,
        industry_db: 40,
      },
    }))
  })

  it('weights related_exp into its 50 point contribution slot', () => {
    expect(overrideIndustryDbBreakdown({
      score: 88,
      summary: '',
      highlights: [],
      recommendation: 'match',
      breakdown: {
        related_exp: 90,
        industry_db: 15,
      },
    }, 50)).toEqual(expect.objectContaining({
      score: 95,
      breakdown: {
        related_exp: 45,
        industry_db: 50,
      },
    }))
  })

  it.each([
    { label: 'rounds to nearest integer', input: 35 as number | undefined, expected: 18 },
    { label: 'keeps at 0 when AI returns 0', input: 0 as number | undefined, expected: 0 },
    { label: 'defaults to 0 when missing', input: undefined, expected: 0 },
  ])('$label for related_exp weight', ({ input, expected }) => {
    expect(overrideIndustryDbBreakdown({
      score: 40,
      summary: '',
      highlights: [],
      recommendation: 'match',
      breakdown: input !== undefined ? { related_exp: input, industry_db: 10 } : { industry_db: 10 },
    }, 0)).toEqual(expect.objectContaining({
      score: expected,
      breakdown: {
        related_exp: expected,
        industry_db: 0,
      },
    }))
  })
})
