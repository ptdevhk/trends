import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useFacetCounts } from '@/hooks/useFacetCounts'
import type { ResumeSearchResultItem } from '@/components/search/search-types'
import type { ConvexResumeItem } from '@/hooks/useConvexResumes'
import type { TaxonomyClusterInput } from '@/lib/taxonomy'

function createResume(overrides: Partial<ConvexResumeItem>): ConvexResumeItem {
  return {
    resumeId: 'resume-1' as ConvexResumeItem['resumeId'],
    externalId: 'resume-1',
    name: 'Candidate',
    profileUrl: '',
    activityStatus: '',
    age: '',
    ageNumber: 30,
    experience: '5 years',
    education: 'Bachelor',
    location: 'Kuala Lumpur',
    extractedAt: new Date().toISOString(),
    expectedSalary: '',
    jobIntention: '',
    selfIntro: '',
    skills: [],
    workHistory: [],
    source: 'seek',
    crawledAt: Date.now(),
    tags: [],
    ingestData: {
      industryTags: ['CNC', 'Machine Tools'],
      synonymHits: [],
      brandHits: [],
      companyHits: ['FANUC'],
      ruleScores: {},
      experienceLevel: 'mid',
      computedAt: Date.now(),
      skillsVersion: 1,
    },
    ...overrides,
  }
}

function createResult(overrides: Partial<ResumeSearchResultItem>): ResumeSearchResultItem {
  return {
    key: overrides.key ?? 'resume-1',
    identityKey: overrides.identityKey ?? overrides.key ?? 'resume-1',
    blocked: overrides.blocked ?? false,
    score: overrides.score ?? 78,
    status: overrides.status ?? 'new',
    statusMeta: overrides.statusMeta,
    resume: overrides.resume ?? createResume({}),
  }
}

describe('useFacetCounts', () => {
  it('aggregates facet counts from search results', () => {
    const taxonomyClusters: TaxonomyClusterInput[] = [
      {
        name: 'Manufacturing Systems',
        slug: 'manufacturing-systems',
        tags: [],
      },
      {
        name: 'Automation Stack',
        slug: 'automation-stack',
        parentSlug: 'manufacturing-systems',
        tags: ['Machine Tools', 'Automation'],
      },
    ]
    const { result } = renderHook(() => useFacetCounts([
      createResult({ key: 'one', score: 85, status: 'new' }),
      createResult({
        key: 'two',
        score: 65,
        status: 'contacted',
        resume: createResume({
          resumeId: 'resume-2' as ConvexResumeItem['resumeId'],
          externalId: 'resume-2',
          name: 'Candidate Two',
          experience: '8 years',
          education: 'Master',
          ingestData: {
            industryTags: ['Machine Tools', 'Automation'],
            synonymHits: [],
            brandHits: [],
            companyHits: ['DMG MORI'],
            ruleScores: {},
            experienceLevel: 'senior',
            computedAt: Date.now(),
            skillsVersion: 1,
          },
        }),
      }),
    ], taxonomyClusters))

    expect(result.current.clusters).toEqual([
      { value: 'manufacturing-systems', label: 'Manufacturing Systems', count: 2 },
    ])
    expect(result.current.tags.slice(0, 2)).toEqual([
      { value: 'Machine Tools', label: undefined, count: 2 },
      { value: 'Automation', label: undefined, count: 1 },
    ])
    expect(result.current.companies).toEqual([
      { value: 'DMG MORI', label: undefined, count: 1 },
      { value: 'FANUC', label: undefined, count: 1 },
    ])
    expect(result.current.experienceLevels).toEqual([
      { value: 'mid', label: undefined, count: 1 },
      { value: 'senior', label: undefined, count: 1 },
    ])
    expect(result.current.education).toEqual([
      { value: 'Bachelor', label: undefined, count: 1 },
      { value: 'Master', label: undefined, count: 1 },
    ])
    expect(result.current.statuses).toEqual([
      { value: 'contacted', label: 'resumes.status.options.contacted', count: 1 },
      { value: 'new', label: 'resumes.status.options.new', count: 1 },
    ])
    expect(result.current.minScoreOptions).toEqual([
      { value: '60', count: 2 },
      { value: '70', count: 1 },
      { value: '80', count: 1 },
      { value: '90', count: 0 },
    ])
  })

  it('counts a parent taxonomy cluster at most once per resume even when multiple child tags match it', () => {
    const taxonomyClusters: TaxonomyClusterInput[] = [
      {
        name: 'Manufacturing Systems',
        slug: 'manufacturing-systems',
        tags: [],
      },
      {
        name: 'Automation Stack',
        slug: 'automation-stack',
        parentSlug: 'manufacturing-systems',
        tags: ['Machine Tools', 'Automation'],
      },
    ]

    const { result } = renderHook(() => useFacetCounts([
      createResult({
        key: 'one',
        resume: createResume({
          ingestData: {
            industryTags: ['Machine Tools', 'Automation'],
            synonymHits: [],
            brandHits: [],
            companyHits: ['FANUC'],
            ruleScores: {},
            experienceLevel: 'mid',
            computedAt: Date.now(),
            skillsVersion: 1,
          },
        }),
      }),
      createResult({
        key: 'two',
        resume: createResume({
          resumeId: 'resume-2' as ConvexResumeItem['resumeId'],
          externalId: 'resume-2',
          ingestData: {
            industryTags: ['Automation'],
            synonymHits: [],
            brandHits: [],
            companyHits: ['DMG MORI'],
            ruleScores: {},
            experienceLevel: 'senior',
            computedAt: Date.now(),
            skillsVersion: 1,
          },
        }),
      }),
    ], taxonomyClusters))

    expect(result.current.clusters).toEqual([
      { value: 'manufacturing-systems', label: 'Manufacturing Systems', count: 2 },
    ])
  })

  it('limits facet bucket computation to the first 2000 results', () => {
    const manyResults = Array.from({ length: 2001 }, (_, index) => createResult({
      key: `resume-${index + 1}`,
      score: 95,
      status: 'new',
      resume: createResume({
        resumeId: `resume-${index + 1}` as ConvexResumeItem['resumeId'],
        externalId: `resume-${index + 1}`,
        education: 'Bachelor',
        ingestData: {
          industryTags: ['Machine Tools'],
          synonymHits: [],
          brandHits: [],
          companyHits: ['FANUC'],
          ruleScores: {},
          experienceLevel: 'mid',
          computedAt: Date.now(),
          skillsVersion: 1,
        },
      }),
    }))

    manyResults[2000] = createResult({
      key: 'resume-over-limit',
      score: 10,
      status: 'contacted',
      resume: createResume({
        resumeId: 'resume-over-limit' as ConvexResumeItem['resumeId'],
        externalId: 'resume-over-limit',
        education: 'Doctorate',
        ingestData: {
          industryTags: ['Robotics'],
          synonymHits: [],
          brandHits: [],
          companyHits: ['DMG MORI'],
          ruleScores: {},
          experienceLevel: 'senior',
          computedAt: Date.now(),
          skillsVersion: 1,
        },
      }),
    })

    const { result } = renderHook(() => useFacetCounts(manyResults))

    expect(result.current.tags).toEqual([
      { value: 'Machine Tools', label: undefined, count: 2000 },
    ])
    expect(result.current.companies).toEqual([
      { value: 'FANUC', label: undefined, count: 2000 },
    ])
    expect(result.current.experienceLevels).toEqual([
      { value: 'mid', label: undefined, count: 2000 },
    ])
    expect(result.current.education).toEqual([
      { value: 'Bachelor', label: undefined, count: 2000 },
    ])
    expect(result.current.statuses).toEqual([
      { value: 'new', label: 'resumes.status.options.new', count: 2000 },
    ])
    expect(result.current.minScoreOptions).toEqual([
      { value: '60', count: 2000 },
      { value: '70', count: 2000 },
      { value: '80', count: 2000 },
      { value: '90', count: 2000 },
    ])
  })
})
