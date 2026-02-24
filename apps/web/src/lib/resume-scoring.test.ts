import { describe, expect, it } from 'vitest'
import {
  buildLearningObservation,
  buildResumeKey,
  getPrecomputedRuleScore,
  hasIngestData,
  isAutoFilteredAnalysis,
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
  workHistory: Array<{ raw: string }>
  extractedAt: string
  resumeId?: string
  perUserId?: string
  ingestData?: {
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

  it('parses valid match breakdown', () => {
    const breakdown = toMatchBreakdown({
      skillMatch: 80,
      experienceMatch: 70,
      educationMatch: 90,
      locationMatch: 60,
      industryMatch: 50,
    })

    expect(breakdown).toEqual({
      skillMatch: 80,
      experienceMatch: 70,
      educationMatch: 90,
      locationMatch: 60,
      industryMatch: 50,
    })
  })

  it('returns undefined for invalid breakdown', () => {
    expect(
      toMatchBreakdown({
        skillMatch: 80,
        experienceMatch: 70,
        educationMatch: 90,
        locationMatch: 60,
      })
    ).toBeUndefined()
  })

  it('prefers resumeId then perUserId then profileUrl for resume key', () => {
    expect(buildResumeKey(createResume({ resumeId: 'r-1', perUserId: 'u-1', profileUrl: 'https://a.com' }), 0)).toBe('r-1')
    expect(buildResumeKey(createResume({ resumeId: undefined, perUserId: 'u-1', profileUrl: 'https://a.com' }), 0)).toBe('u-1')
    expect(buildResumeKey(createResume({ resumeId: undefined, perUserId: undefined, profileUrl: 'https://a.com' }), 0)).toBe('https://a.com')
  })

  it('reads precomputed rule score from ingest data', () => {
    const score = getPrecomputedRuleScore(
      createResume({
        ingestData: {
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
      expect(buildLearningObservation('shortlist', resume)).toBe('shortlist pattern -> cnc/lathe + senior')
    }
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
})
