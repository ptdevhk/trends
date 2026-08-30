import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ResumeCard } from './ResumeCard'
import type { ResumeItem } from '@/hooks/useResumes'

const useAuthMock = vi.hoisted(() => vi.fn())

const mockT = (key: string, options?: string | Record<string, unknown>) => {
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
};

const mockI18n = {
  language: 'en',
  languages: ['en', 'zh-Hans', 'zh-Hant'],
  changeLanguage: () => Promise.resolve(),
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
    i18n: mockI18n,
  }),
}))

vi.mock('@/hooks/useCompanyPolicyIndex', () => ({
  useCompanyPolicyIndex: () => ({
    aliasIndexByMarket: { cn: new Map(), my: new Map() },
    loading: false,
    error: null,
    load: vi.fn(),
    hasPolicies: false,
    matchResume: () => [],
  }),
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'hr' }),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}))

const baseResume = {
  name: 'Alice',
  profileUrl: 'https://example.com/resume-1',
  activityStatus: 'Active',
  age: '30',
  experience: '8 years',
  education: 'Bachelor',
  location: 'Malaysia',
  selfIntro: 'Test intro',
  jobIntention: 'Sales Engineer',
  expectedSalary: '10k-20k',
  workHistory: [],
  extractedAt: '2026-03-13T00:00:00.000Z',
}

describe('ResumeCard brand-hit badges', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ memberships: [] })
  })

  it('renders only approved verified industry evidence from the materialized projection', () => {
    render(
      <ResumeCard
        resume={{
          ...baseResume,
          ingestData: {
            verifiedIndustryEvidenceSummaries: [{
              companyKey: 'acme-cnc',
              companyName: 'Acme CNC',
              industryClass: 'cnc',
              verificationLevel: 'verified',
              verdictRevisionId: 'revision-1',
              evidenceSummary: 'Human-approved CNC machinery evidence.',
              reviewedAt: Date.UTC(2026, 6, 20),
              sourceCount: 0,
              sourcePreviews: [],
            }, {
              companyKey: 'candidate-company',
              companyName: 'Candidate Company',
              industryClass: 'cnc',
              verificationLevel: 'candidate',
              verdictRevisionId: 'candidate-revision',
              evidenceSummary: 'Unreviewed candidate evidence.',
              reviewedAt: Date.UTC(2026, 6, 20),
              sourceCount: 0,
              sourcePreviews: [],
            }],
          },
        } as unknown as ResumeItem}
        onViewDetails={vi.fn()}
      />
    )

    expect(screen.getByText(/CNC (Verified|行业验证)/)).toBeInTheDocument()
    expect(screen.getByText('Acme CNC')).toBeInTheDocument()
    expect(screen.queryByText('Candidate Company')).not.toBeInTheDocument()
  })

  it('shows a generic needs refresh badge when the resume requires refresh', () => {
    render(
      <ResumeCard
        resume={{
          name: 'Alice',
          profileUrl: 'https://example.com/resume-1',
          activityStatus: 'Active',
          age: '30',
          experience: '5 years',
          education: 'Bachelor',
          location: 'Dongguan',
          selfIntro: 'Test intro',
          jobIntention: 'Sales Engineer',
          expectedSalary: '10k-20k',
          workHistory: [],
          extractedAt: '2026-03-13T00:00:00.000Z',
        }}
        refreshState={{
          kind: 'ingest_stale',
          isStale: true,
          ingestStale: true,
          analysisStale: false,
          actions: ['reingest'],
        }}
        onViewDetails={vi.fn()}
      />
    )

    expect(screen.getByText('Needs refresh')).toBeInTheDocument()
  })

  it('renders deduped brand names without debug metadata', () => {
    render(
      <ResumeCard
        resume={{
          name: 'Alice',
          profileUrl: 'https://example.com/resume-1',
          activityStatus: 'Active',
          age: '30',
          experience: '5 years',
          education: 'Bachelor',
          location: 'Dongguan',
          selfIntro: 'Test intro',
          jobIntention: 'Sales Engineer',
          expectedSalary: '10k-20k',
          workHistory: [{ raw: 'Test work history' }],
          extractedAt: '2026-03-13T00:00:00.000Z',
        }}
        onViewDetails={vi.fn()}
        brandDisplayResolve={(brandId) => (brandId === 'fanuc' ? '发那科' : brandId.toUpperCase())}
        brandHits={[
          { brand: 'fanuc', context: 'equipment', source: 'workHistory', role: 'vendor' },
          { brand: 'fanuc', context: 'sales', source: 'selfIntro', role: 'vendor' },
          { brand: 'fanuc', context: 'employer', source: 'workHistory', role: 'employer' },
        ]}
      />
    )

    expect(screen.getAllByText('发那科')).toHaveLength(1)
    expect(screen.queryByText('debugIngest.brandContext.equipment')).not.toBeInTheDocument()
    expect(screen.queryByText('debugIngest.brandContext.sales')).not.toBeInTheDocument()
    expect(screen.queryByText(/workHistory/i)).not.toBeInTheDocument()
  })

  it('renders only the latest three work history entries', () => {
    render(
      <ResumeCard
        resume={{
          name: 'Alice',
          profileUrl: 'https://example.com/resume-1',
          activityStatus: 'Active',
          age: '30',
          experience: '5 years',
          education: 'Bachelor',
          location: 'Dongguan',
          selfIntro: 'Test intro',
          jobIntention: 'Sales Engineer',
          expectedSalary: '10k-20k',
          workHistory: [
            { raw: 'Oldest entry', companyName: 'Oldest Co', jobTitle: 'Old Role', startDate: '2018-01', endDate: '2019-01' },
            { raw: 'Recent entry', companyName: 'Recent Co', jobTitle: 'Recent Role', startDate: '2023-01', endDate: '2024-01' },
            { raw: 'Current entry', companyName: 'Current Co', jobTitle: 'Current Role', startDate: '2024-02', endDate: '至今' },
            { raw: 'Middle entry', companyName: 'Middle Co', jobTitle: 'Middle Role', startDate: '2021-01', endDate: '2022-01' },
          ],
          extractedAt: '2026-03-13T00:00:00.000Z',
        }}
        onViewDetails={vi.fn()}
      />
    )

    // Work history rows now render company, role, and date range as distinct parts
    // so users can tell the company apart from the position at a glance.
    expect(screen.getByText('Current Co')).toBeInTheDocument()
    expect(screen.getByText('Current Role')).toBeInTheDocument()
    expect(screen.getByText('2024-02 ~ 至今')).toBeInTheDocument()
    expect(screen.getByText('Recent Co')).toBeInTheDocument()
    expect(screen.getByText('Recent Role')).toBeInTheDocument()
    expect(screen.getByText('2023-01 ~ 2024-01')).toBeInTheDocument()
    expect(screen.getByText('Middle Co')).toBeInTheDocument()
    expect(screen.getByText('Middle Role')).toBeInTheDocument()
    expect(screen.getByText('2021-01 ~ 2022-01')).toBeInTheDocument()
    expect(screen.queryByText('Oldest Co')).not.toBeInTheDocument()
    expect(screen.queryByText('Old Role')).not.toBeInTheDocument()
    expect(screen.queryByText('2018-01 ~ 2019-01 Oldest Co Old Role')).not.toBeInTheDocument()
  })

  it('hides excluded presentation fields by default', () => {
    render(
      <ResumeCard
        resume={{
          name: 'Alice',
          profileUrl: 'https://example.com/resume-1',
          activityStatus: 'Active',
          age: '30',
          experience: '5 years',
          education: 'Bachelor',
          location: 'Dongguan',
          selfIntro: 'Test intro',
          jobIntention: 'Sales Engineer',
          expectedSalary: '10k-20k',
          workHistory: [],
          extractedAt: '2026-03-13T00:00:00.000Z',
        }}
        onViewDetails={vi.fn()}
      />
    )

    expect(screen.queryByText('Sales Engineer')).not.toBeInTheDocument()
    expect(screen.queryByText('Test intro')).not.toBeInTheDocument()
  })

  it('shows AI pending instead of rule scoring when AI mode is enabled but analysis is missing', () => {
    render(
      <ResumeCard
        resume={{
          name: 'Alice',
          profileUrl: 'https://example.com/resume-1',
          activityStatus: 'Active',
          age: '30',
          experience: '5 years',
          education: 'Bachelor',
          location: 'Dongguan',
          selfIntro: 'Test intro',
          jobIntention: 'Sales Engineer',
          expectedSalary: '10k-20k',
          workHistory: [],
          extractedAt: '2026-03-13T00:00:00.000Z',
        }}
        matchResult={{
          resumeId: 'resume-1',
          score: 74,
          recommendation: 'match',
          highlights: [],
          concerns: [],
          summary: '',
          matchedAt: '2026-03-13T00:00:00.000Z',
          scoreSource: 'rule',
        }}
        showAiScore
        onViewDetails={vi.fn()}
      />
    )

    expect(screen.getByText('AI pending')).toBeInTheDocument()
    expect(screen.queryByText('Rule')).not.toBeInTheDocument()
    expect(screen.queryByText('74')).not.toBeInTheDocument()
  })

  it('uses the darker AI badge treatment for accessible contrast', () => {
    render(
      <ResumeCard
        resume={baseResume}
        matchResult={{
          resumeId: 'resume-1',
          score: 88,
          recommendation: 'strong_match',
          highlights: [],
          concerns: [],
          summary: 'Strong AI match',
          matchedAt: '2026-03-13T00:00:00.000Z',
          scoreSource: 'ai',
        }}
        onViewDetails={vi.fn()}
      />
    )

    expect(screen.getByText('AI').className).toContain('bg-sky-700')
  })

  it('shows a content-locale badge when the resume source maps to a locale', () => {
    render(
      <ResumeCard
        resume={{
          name: 'Bob',
          profileUrl: 'https://hk.employer.seek.com/candidates/123',
          activityStatus: 'Active',
          age: '28',
          experience: '3 years',
          education: 'Bachelor',
          location: 'Kuala Lumpur',
          selfIntro: 'Experienced sales engineer',
          jobIntention: 'Sales Engineer',
          expectedSalary: '8k-12k',
          workHistory: [],
          extractedAt: '2026-03-13T00:00:00.000Z',
          source: 'hk.employer.seek.com',
        }}
        onViewDetails={vi.fn()}
      />
    )

    expect(screen.getByText('EN')).toBeInTheDocument()
  })

  it('does not show a content-locale badge when no locale is resolved', () => {
    render(
      <ResumeCard
        resume={{
          name: 'Charlie',
          profileUrl: 'https://example.com/resume-1',
          activityStatus: 'Active',
          age: '35',
          experience: '10 years',
          education: 'Master',
          location: 'Shenzhen',
          selfIntro: 'Experienced engineer',
          jobIntention: 'CNC Engineer',
          expectedSalary: '15k-25k',
          workHistory: [],
          extractedAt: '2026-03-13T00:00:00.000Z',
        }}
        onViewDetails={vi.fn()}
      />
    )

    expect(screen.queryByText('EN')).not.toBeInTheDocument()
    expect(screen.queryByText('ZH')).not.toBeInTheDocument()
  })

  it('prefers the active role filter badge over a stronger unrelated verified role badge', () => {
    render(
      <ResumeCard
        resume={baseResume}
        onViewDetails={vi.fn()}
        activeRoleFilterType="sales"
        roleSignals={[
          {
            type: 'sales',
            matchedSignals: ['Sales Manager'],
            signalCount: 1,
            occurrences: 1,
            years: 5.4,
            roleRelevantYears: 5.4,
            industryVerifiedRelevantYears: 0,
            industryVerifiedYears: 0,
            matchedWorkEntries: [{
              companyName: 'Acme MY',
              jobTitle: 'Sales Manager',
              years: 5.4,
              industryVerified: false,
              matchedSignals: ['Sales Manager'],
            }],
            verifyIn: 'workHistory',
          },
          {
            type: 'engineer',
            matchedSignals: ['Application Engineer'],
            signalCount: 1,
            occurrences: 1,
            years: 7,
            roleRelevantYears: 7,
            industryVerifiedRelevantYears: 7,
            industryVerifiedYears: 7,
            matchedWorkEntries: [{
              companyName: 'Acme MY',
              jobTitle: 'Application Engineer',
              years: 7,
              industryVerified: true,
              matchedSignals: ['Application Engineer'],
            }],
            verifyIn: 'workHistory',
          },
        ]}
      />
    )

    expect(screen.getByText('销售5.4年')).toBeInTheDocument()
    expect(screen.queryByText('工程7年 (Industry verified)')).not.toBeInTheDocument()
  })

  it('renders compact chips when screeningChecklist is present on matchResult', () => {
    render(
      <ResumeCard
        resume={baseResume}
        matchResult={{
          resumeId: 'resume-1',
          score: 88,
          recommendation: 'strong_match',
          highlights: [],
          concerns: [],
          summary: 'Strong AI match',
          matchedAt: '2026-03-13T00:00:00.000Z',
          scoreSource: 'ai',
          screeningChecklist: {
            generatedBy: 'rules+ai',
            sellsMachines: { verdict: 'yes', evidence: 'Direct machine sales' },
            machineOrigin: { verdict: 'international', evidence: 'Imported FANUC CNC' },
            channel: { verdict: 'direct', evidence: 'Direct sales' },
          },
        }}
        onViewDetails={vi.fn()}
      />
    )

    const chips = screen.getByTestId('screening-checklist-chips')
    expect(chips).toBeInTheDocument()
    expect(within(chips).getByText('✓ 有賣機')).toBeInTheDocument()
    expect(within(chips).getByText('進口')).toBeInTheDocument()
    expect(within(chips).getByText('直銷')).toBeInTheDocument()
  })

  it('renders nothing for checklist chips when screeningChecklist is absent', () => {
    render(
      <ResumeCard
        resume={baseResume}
        matchResult={{
          resumeId: 'resume-1',
          score: 88,
          recommendation: 'strong_match',
          highlights: [],
          concerns: [],
          summary: 'Strong AI match',
          matchedAt: '2026-03-13T00:00:00.000Z',
          scoreSource: 'ai',
        }}
        onViewDetails={vi.fn()}
      />
    )

    expect(screen.queryByTestId('screening-checklist-chips')).not.toBeInTheDocument()
  })

  it('keeps the strongest current approved role badge when no active role filter is provided', () => {
    render(
      <ResumeCard
        resume={{
          ...baseResume,
          ingestData: {
            verifiedIndustryEvidenceSummaries: [{
              companyKey: 'acme-my',
              companyName: 'Acme MY',
              industryClass: 'cnc',
              verificationLevel: 'verified',
              verdictRevisionId: 'revision-acme-engineer',
              evidenceSummary: 'Human-approved CNC machinery evidence.',
              reviewedAt: Date.UTC(2026, 6, 20),
              sourceCount: 0,
              sourcePreviews: [],
            }],
          },
        } as unknown as ResumeItem}
        onViewDetails={vi.fn()}
        roleSignals={[
          {
            type: 'sales',
            matchedSignals: ['Sales Manager'],
            signalCount: 1,
            occurrences: 1,
            years: 5.4,
            roleRelevantYears: 5.4,
            industryVerifiedRelevantYears: 0,
            industryVerifiedYears: 0,
            matchedWorkEntries: [{
              companyName: 'Acme MY',
              jobTitle: 'Sales Manager',
              years: 5.4,
              industryVerified: false,
              matchedSignals: ['Sales Manager'],
            }],
            verifyIn: 'workHistory',
          },
          {
            type: 'engineer',
            matchedSignals: ['Application Engineer'],
            signalCount: 1,
            occurrences: 1,
            years: 7,
            roleRelevantYears: 7,
            industryVerifiedRelevantYears: 7,
            industryVerifiedYears: 7,
            matchedWorkEntries: [{
              companyName: 'Acme MY',
              companyKey: 'acme-my',
              jobTitle: 'Application Engineer',
              years: 7,
              industryVerified: true,
              verdictRevisionId: 'revision-acme-engineer',
              directRoleMatch: true,
              matchedSignals: ['Application Engineer'],
            }],
            verifyIn: 'workHistory',
          },
        ]}
      />
    )

    expect(screen.getByText('工程7年 (Industry verified)')).toBeInTheDocument()
    expect(screen.queryByText('销售5.4年')).not.toBeInTheDocument()
  })

  it('does not present a revisionless industry rules signal as verified', () => {
    useAuthMock.mockReturnValue({
      memberships: [{ workspaceSlug: 'dev', role: 'admin' }],
    })

    render(
      <ResumeCard
        resume={baseResume}
        onViewDetails={vi.fn()}
        roleSignals={[{
          type: 'sales',
          matchedSignals: ['CNC Sales'],
          signalCount: 1,
          occurrences: 1,
          years: 4,
          roleRelevantYears: 4,
          industryVerifiedRelevantYears: 4,
          industryVerifiedYears: 4,
          matchedWorkEntries: [{
            companyName: 'Vision Machine Tools',
            jobTitle: 'Sales Engineer',
            years: 4,
            industryVerified: true,
            matchedSignals: ['CNC Sales'],
          }],
          verifyIn: 'workHistory',
        }]}
      />,
    )

    expect(screen.queryByText('销售4年 (Industry verified)')).not.toBeInTheDocument()
    expect(screen.getByText('Legacy rules signal')).toBeInTheDocument()
  })

  it('shows the legacy rules badge for an active-workspace reviewer', () => {
    useAuthMock.mockReturnValue({
      memberships: [{ userId: 'u1', workspaceSlug: 'hr', role: 'reviewer' }],
    })

    render(
      <ResumeCard
        resume={baseResume}
        onViewDetails={vi.fn()}
        roleSignals={[{
          type: 'sales',
          matchedSignals: ['CNC Sales'],
          signalCount: 1,
          occurrences: 1,
          years: 4,
          roleRelevantYears: 4,
          industryVerifiedRelevantYears: 4,
          industryVerifiedYears: 4,
          matchedWorkEntries: [{
            companyName: 'Vision Machine Tools',
            jobTitle: 'Sales Engineer',
            years: 4,
            industryVerified: true,
            matchedSignals: ['CNC Sales'],
          }],
          verifyIn: 'workHistory',
        }]}
      />,
    )

    expect(screen.getByText('Legacy rules signal')).toBeInTheDocument()
  })

  it('hides the legacy rules badge from plain members', () => {
    useAuthMock.mockReturnValue({
      memberships: [{ userId: 'u1', workspaceSlug: 'hr', role: 'user' }],
    })

    render(
      <ResumeCard
        resume={baseResume}
        onViewDetails={vi.fn()}
        roleSignals={[{ type: 'sales', matchedSignals: ['CNC Sales'], signalCount: 1, occurrences: 1, years: 4, verifyIn: 'workHistory' }]}
      />,
    )

    expect(screen.queryByText('Legacy rules signal')).not.toBeInTheDocument()
  })

  it('ignores Enter during IME composition in the block dialog note input', () => {
    const onToggleBlock = vi.fn()

    render(
      <ResumeCard
        resume={baseResume}
        onViewDetails={vi.fn()}
        blocked={false}
        onToggleBlock={onToggleBlock}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Block' }))
    const input = screen.getByPlaceholderText('Note')

    // IME composition Enter must not submit
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(onToggleBlock).not.toHaveBeenCalled()

    // Plain Enter submits the block action with no reason
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onToggleBlock).toHaveBeenCalledWith(undefined)
  })
})
