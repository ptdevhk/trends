import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SnippetCardExpanded } from '@/components/search/SnippetCardExpanded'
import type { ResumeSearchResultItem } from '@/components/search/search-types'
import type { ConvexResumeItem } from '@/hooks/useConvexResumes'

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

vi.mock('@trends/shared', () => ({
  buildWorkHistoryEntryText: (...args: unknown[]) => buildWorkHistoryEntryTextMock(...args),
  sanitizeResumeRecordForSurface: (...args: unknown[]) => sanitizeResumeRecordForSurfaceMock(...args),
  selectLatestWorkHistory: (...args: unknown[]) => selectLatestWorkHistoryMock(...args),
}))

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
    blocked: overrides.blocked ?? false,
    score: overrides.score ?? 90,
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
    render(<SnippetCardExpanded item={createResult(1)} />)

    expect(screen.getByText('Snapshot')).toBeInTheDocument()
    expect(screen.getByText('Strong machine-tools operator with channel sales depth.')).toBeInTheDocument()
    expect(screen.getByText('Recent work')).toBeInTheDocument()
    expect(screen.getByText('Sales Engineer @ FANUC')).toBeInTheDocument()
    expect(screen.getByText('Account Manager @ DMG MORI')).toBeInTheDocument()
    expect(screen.getByText('Malaysia')).toBeInTheDocument()
    expect(screen.getByText('Bachelor')).toBeInTheDocument()
    expect(screen.getByText('Status: interviewed reject')).toBeInTheDocument()
    expect(screen.getByText('Machine Tools')).toBeInTheDocument()
    expect(screen.getByText('Automation')).toBeInTheDocument()
    expect(screen.getByText('Robotics')).toBeInTheDocument()
    expect(screen.getByText('FANUC')).toBeInTheDocument()
    expect(screen.getByText('DMG MORI')).toBeInTheDocument()
    expect(screen.getByText('senior')).toBeInTheDocument()

    const link = screen.getByRole('link', { name: /Open source profile/i })
    expect(link).toHaveAttribute('href', 'https://example.com/profile')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('falls back when summary, work history, metadata, and profile URL are missing', () => {
    render(
      <SnippetCardExpanded
        item={createResult(2, {
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

    expect(screen.getByText('No summary available for this resume yet.')).toBeInTheDocument()
    expect(screen.getByText('No structured work history available.')).toBeInTheDocument()
    expect(screen.getByText('No location')).toBeInTheDocument()
    expect(screen.getByText('No education listed')).toBeInTheDocument()
    expect(screen.getByText('Status: new')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Open source profile/i })).not.toBeInTheDocument()
  })
})
