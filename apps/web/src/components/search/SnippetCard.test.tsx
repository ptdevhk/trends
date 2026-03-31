import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SnippetCard } from '@/components/search/SnippetCard'
import type { ResumeSearchResultItem } from '@/components/search/search-types'
import type { ConvexResumeItem } from '@/hooks/useConvexResumes'

vi.mock('@/components/search/SnippetCardExpanded', () => ({
  SnippetCardExpanded: ({ item }: { item: ResumeSearchResultItem }) => (
    <div>Expanded card for {item.resume.name ?? 'Unnamed resume'}</div>
  ),
}))

function createResume(index: number, overrides: Partial<ConvexResumeItem> = {}): ConvexResumeItem {
  return {
    resumeId: `resume-${index}` as ConvexResumeItem['resumeId'],
    externalId: `resume-${index}`,
    name: `Candidate ${index}`,
    profileUrl: '',
    activityStatus: '',
    age: '',
    ageNumber: 30,
    experience: '6 years',
    education: 'Bachelor',
    location: 'Kuala Lumpur',
    extractedAt: new Date('2026-03-27T10:00:00.000Z').toISOString(),
    expectedSalary: '',
    jobIntention: 'Regional sales coverage',
    selfIntro: 'Short intro summary',
    skills: [],
    workHistory: [
      {
        companyName: `Company ${index}`,
        jobTitle: 'Regional Sales Manager',
        raw: 'Led machine tools growth across Malaysia.',
      },
    ],
    source: 'seek',
    crawledAt: Date.now(),
    tags: [],
    ingestData: {
      industryTags: ['Machine Tools', 'Automation', 'Robotics', 'Servo'],
      synonymHits: [],
      brandHits: [],
      companyHits: ['FANUC'],
      ruleScores: {},
      experienceLevel: 'senior',
      computedAt: Date.now(),
      skillsVersion: 1,
    },
    _provenance: [
      { term: 'CNC', source: 'searchText' },
      { term: 'Machine Tools', source: 'industryTags' },
      { term: 'Malaysia', source: 'searchText' },
      { term: 'Ignored', source: 'searchText' },
    ],
    ...overrides,
  }
}

function createResult(index: number, overrides: Partial<ResumeSearchResultItem> = {}): ResumeSearchResultItem {
  const hasScoreOverride = Object.prototype.hasOwnProperty.call(overrides, 'score')

  return {
    key: overrides.key ?? `resume-${index}`,
    identityKey: overrides.identityKey ?? `identity-${index}`,
    analysis: overrides.analysis,
    blocked: overrides.blocked ?? false,
    score: hasScoreOverride ? overrides.score : 87.6,
    scoreSource: overrides.scoreSource ?? 'ai',
    status: overrides.status ?? 'new',
    statusMeta: overrides.statusMeta,
    resume: overrides.resume ?? createResume(index),
  }
}

describe('SnippetCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders headline, score, provenance keywords, and toggles expansion', async () => {
    const user = userEvent.setup()
    const onToggleExpanded = vi.fn()

    render(
      <SnippetCard
        expanded
        item={createResult(1, {
          analysis: {
            score: 87.6,
            summary: 'Strong CNC sales coverage across Malaysia.',
            highlights: [],
            recommendation: 'strong_match',
          },
        })}
        onToggleExpanded={onToggleExpanded}
      />
    )

    expect(screen.getByText('Candidate 1')).toBeInTheDocument()
    expect(screen.getByText('Regional Sales Manager')).toBeInTheDocument()
    expect(screen.getByText('Led machine tools growth across Malaysia.')).toBeInTheDocument()
    expect(screen.getByText('Kuala Lumpur')).toBeInTheDocument()
    expect(screen.getByText('6 years')).toBeInTheDocument()
    expect(screen.getByText('senior')).toBeInTheDocument()
    expect(screen.getByText('88')).toBeInTheDocument()
    expect(screen.getByText('AI')).toBeInTheDocument()
    expect(screen.getByText('CNC')).toBeInTheDocument()
    expect(screen.getByText('Machine Tools')).toBeInTheDocument()
    expect(screen.getByText('Malaysia')).toBeInTheDocument()
    expect(screen.getByText(/AI summary: Strong CNC sales coverage across Malaysia\./i)).toBeInTheDocument()
    expect(screen.queryByText('Ignored')).not.toBeInTheDocument()
    expect(screen.getByText('Expanded card for Candidate 1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Collapse/i }))

    expect(onToggleExpanded).toHaveBeenCalled()
  })

  it('falls back to generic labels and ingest tags when work history and provenance are missing', async () => {
    const user = userEvent.setup()
    const onToggleExpanded = vi.fn()

    render(
      <SnippetCard
        expanded={false}
        item={createResult(2, {
          scoreSource: undefined,
          score: undefined,
          resume: createResume(2, {
            name: '',
            jobIntention: '',
            selfIntro: '',
            workHistory: [],
            location: '',
            experience: '',
            ingestData: {
              industryTags: ['Automation', 'PLC', 'CNC'],
              synonymHits: [],
              brandHits: [],
              companyHits: [],
              ruleScores: {},
              experienceLevel: 'mid',
              computedAt: Date.now(),
              skillsVersion: 1,
            },
            _provenance: undefined,
          }),
        })}
        onToggleExpanded={onToggleExpanded}
      />
    )

    expect(screen.getByText('Unnamed resume')).toBeInTheDocument()
    expect(screen.getByText('Profile overview')).toBeInTheDocument()
    expect(
      screen.queryByText('Open the card to inspect recent work history and extracted signals.'),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Automation')).toBeInTheDocument()
    expect(screen.getByText('PLC')).toBeInTheDocument()
    expect(screen.getByText('CNC')).toBeInTheDocument()
    expect(screen.queryByText('Expanded card for Unnamed resume')).not.toBeInTheDocument()
    expect(screen.queryByText('mid')).toBeInTheDocument()
    expect(screen.queryByText('88')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Expand/i }))

    expect(onToggleExpanded).toHaveBeenCalled()
  })
})
