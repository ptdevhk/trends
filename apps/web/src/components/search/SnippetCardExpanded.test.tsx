import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SnippetCardExpanded } from '@/components/search/SnippetCardExpanded'
import type { ResumeSearchResultItem } from '@/components/search/search-types'
import type { ConvexResumeItem } from '@/hooks/useConvexResumes'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      if (typeof options === 'string') {
        return options
      }

      const defaultValue =
        options && typeof options === 'object' && typeof options.defaultValue === 'string'
          ? options.defaultValue
          : key
      return defaultValue.replace(/\{\{(\w+)\}\}/g, (_, token: string) => {
        const value = options && typeof options === 'object' ? options[token] : undefined
        return value === undefined || value === null ? '' : String(value)
      })
    },
  }),
}))

const {
  buildWorkHistoryEntryTextMock,
  sanitizeResumeRecordForSurfaceMock,
  selectLatestWorkHistoryMock,
  useResumeFieldUsagePolicyMock,
} = vi.hoisted(() => ({
  buildWorkHistoryEntryTextMock: vi.fn(),
  sanitizeResumeRecordForSurfaceMock: vi.fn(),
  selectLatestWorkHistoryMock: vi.fn(),
  useResumeFieldUsagePolicyMock: vi.fn(),
}))

vi.mock('@trends/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@trends/shared')>()
  return {
    ...actual,
    buildWorkHistoryEntryText: (...args: unknown[]) => buildWorkHistoryEntryTextMock(...args),
    sanitizeResumeRecordForSurface: (...args: unknown[]) => sanitizeResumeRecordForSurfaceMock(...args),
    selectLatestWorkHistory: (...args: unknown[]) => selectLatestWorkHistoryMock(...args),
  }
})

vi.mock('@/contexts/ResumeFieldUsagePolicyContext', () => ({
  useResumeFieldUsagePolicy: () => useResumeFieldUsagePolicyMock(),
}))

function createResume(index: number, overrides: Partial<ConvexResumeItem> = {}): ConvexResumeItem {
  return {
    resumeId: `resume-${index}` as ConvexResumeItem['resumeId'],
    externalId: `resume-${index}`,
    name: `Candidate ${index}`,
    profileUrl: 'https://example.com/profile',
    activityStatus: '',
    age: '',
    ageNumber: 30,
    experience: '8 years',
    education: 'Bachelor',
    location: 'Malaysia',
    extractedAt: new Date('2026-03-27T10:00:00.000Z').toISOString(),
    expectedSalary: '',
    jobIntention: 'Regional sales coverage',
    selfIntro: 'Strong machine-tools operator with channel sales depth.',
    skills: [],
    workHistory: [
      { companyName: 'FANUC', jobTitle: 'Sales Engineer', raw: 'Built CNC pipeline' },
      { companyName: 'DMG MORI', jobTitle: 'Account Manager', raw: 'Expanded distributor network' },
    ],
    source: 'seek',
    crawledAt: Date.now(),
    tags: [],
    ingestData: {
      industryTags: ['Machine Tools', 'Automation', 'Robotics'],
      synonymHits: [],
      brandHits: [],
      companyHits: ['FANUC', 'DMG MORI'],
      ruleScores: {},
      experienceLevel: 'senior',
      computedAt: Date.now(),
      skillsVersion: 1,
    },
    ...overrides,
  }
}

function createResult(index: number, overrides: Partial<ResumeSearchResultItem> = {}): ResumeSearchResultItem {
  return {
    key: overrides.key ?? `resume-${index}`,
    identityKey: overrides.identityKey ?? `identity-${index}`,
    analysis: overrides.analysis,
    blocked: overrides.blocked ?? false,
    score: overrides.score ?? 90,
    scoreSource: overrides.scoreSource ?? 'ai',
    status: overrides.status ?? 'interviewed_reject',
    statusMeta: overrides.statusMeta,
    resume: overrides.resume ?? createResume(index),
  }
}

describe('SnippetCardExpanded', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useResumeFieldUsagePolicyMock.mockReturnValue({})
    sanitizeResumeRecordForSurfaceMock.mockImplementation((resume: ConvexResumeItem) => resume)
    selectLatestWorkHistoryMock.mockImplementation((workHistory: ConvexResumeItem['workHistory']) => workHistory ?? [])
    buildWorkHistoryEntryTextMock.mockImplementation((entry: { companyName?: string; jobTitle?: string }) =>
      [entry.jobTitle, entry.companyName].filter(Boolean).join(' @ ')
    )
  })

  it('renders snapshot, metadata, signals, and a safe source-profile link', () => {
    render(
      <SnippetCardExpanded
        item={createResult(1, {
          analysis: {
            score: 90,
            summary: 'Strong CNC sales fit with current machine-tool coverage.',
            highlights: ['CNC sales', 'FANUC', 'Channel development'],
            concerns: ['No Mandarin listed'],
            recommendation: 'strong_match',
            breakdown: {
              industry_db: 48,
              related_exp: 24,
            },
          },
        })}
      />
    )

    expect(screen.getByText('Snapshot')).toBeInTheDocument()
    expect(screen.getByText('Strong machine-tools operator with channel sales depth.')).toBeInTheDocument()
    expect(screen.getByText('AI analysis')).toBeInTheDocument()
    expect(screen.getByText('Strong CNC sales fit with current machine-tool coverage.')).toBeInTheDocument()
    expect(screen.getByText('CNC sales')).toBeInTheDocument()
    expect(screen.getByText('Channel development')).toBeInTheDocument()
    expect(screen.getByText('No Mandarin listed')).toBeInTheDocument()
    expect(screen.getByText('industry db')).toBeInTheDocument()
    expect(screen.getByText('48')).toBeInTheDocument()
    expect(screen.getByText('related exp')).toBeInTheDocument()
    expect(screen.getByText('24')).toBeInTheDocument()
    expect(screen.getByText('Recent work')).toBeInTheDocument()
    expect(screen.getByText('Sales Engineer @ FANUC')).toBeInTheDocument()
    expect(screen.getByText('Account Manager @ DMG MORI')).toBeInTheDocument()
    expect(screen.getByText('Malaysia')).toBeInTheDocument()
    expect(screen.getByText('Bachelor')).toBeInTheDocument()
    expect(screen.getByText('Status: interviewed reject')).toBeInTheDocument()
    expect(screen.getByText('Machine Tools')).toBeInTheDocument()
    expect(screen.getByText('Automation')).toBeInTheDocument()
    expect(screen.getByText('Robotics')).toBeInTheDocument()
    expect(screen.getAllByText('FANUC').length).toBeGreaterThan(0)
    expect(screen.getByText('DMG MORI')).toBeInTheDocument()
    expect(screen.getByText('senior')).toBeInTheDocument()

    const link = screen.getByRole('link', { name: /Open source profile/i })
    expect(link).toHaveAttribute('href', 'https://example.com/profile')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('renders a direct details button when requested and calls back on click', () => {
    const onViewDetails = vi.fn()

    render(
      <SnippetCardExpanded
        item={createResult(5)}
        onViewDetails={onViewDetails}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /View details/i }))
    expect(onViewDetails).toHaveBeenCalledTimes(1)
  })

  it('falls back when summary, work history, metadata, and profile URL are missing', () => {
    render(
      <SnippetCardExpanded
        item={createResult(2, {
          scoreSource: 'rule',
          status: 'new',
          resume: createResume(2, {
            profileUrl: 'javascript:alert(1)',
            location: '',
            education: '',
            selfIntro: '',
            jobIntention: '',
            workHistory: [],
            ingestData: {
              industryTags: [],
              synonymHits: [],
              brandHits: [],
              companyHits: [],
              ruleScores: {},
              experienceLevel: '',
              computedAt: Date.now(),
              skillsVersion: 1,
            },
          }),
        })}
      />
    )

    expect(screen.getByText('Score source')).toBeInTheDocument()
    expect(screen.getByText('AI summary is not available for this resume. The current visible score comes from rule scoring only.')).toBeInTheDocument()
    expect(screen.getByText('No summary available for this resume yet.')).toBeInTheDocument()
    expect(screen.getByText('No structured work history available.')).toBeInTheDocument()
    expect(screen.getByText('No location')).toBeInTheDocument()
    expect(screen.getByText('No education listed')).toBeInTheDocument()
    expect(screen.getByText('Status: new')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Open source profile/i })).not.toBeInTheDocument()
  })

  it('shows AI pending text instead of rule scoring when AI mode is enabled and analysis is missing', () => {
    render(
      <SnippetCardExpanded
        showAiScore
        item={createResult(3, {
          scoreSource: 'rule',
          score: 74,
          resume: createResume(3, {
            selfIntro: '',
            jobIntention: '',
            workHistory: [],
          }),
        })}
      />
    )

    expect(screen.getByText('AI analysis pending')).toBeInTheDocument()
    expect(screen.getByText('AI pending')).toBeInTheDocument()
    expect(
      screen.getByText(
        'AI analysis is not available for this resume yet. The score will appear after analysis completes.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Rule 74')).not.toBeInTheDocument()
  })

  it('shows AI pending text when AI mode is enabled and no score has been computed yet', () => {
    const item = createResult(4, {
      scoreSource: 'rule',
      resume: createResume(4, {
        selfIntro: '',
        jobIntention: '',
        workHistory: [],
      }),
    })
    item.score = undefined

    render(
      <SnippetCardExpanded
        showAiScore
        item={item}
      />
    )

    expect(screen.getByText('AI analysis pending')).toBeInTheDocument()
    expect(screen.getByText('AI pending')).toBeInTheDocument()
    expect(screen.queryByText('Rule')).not.toBeInTheDocument()
  })
})
