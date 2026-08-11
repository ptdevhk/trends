import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ResumeDetail } from './ResumeDetail'
import type { ResumeItem } from '@/hooks/useResumes'

const useResumeWorkHistoryLimitMock = vi.hoisted(() => vi.fn())
const useAuthMock = vi.hoisted(() => vi.fn())
const apiGetMock = vi.hoisted(() => vi.fn())

vi.mock('@/contexts/ResumeWorkHistoryLimitContext', () => ({
  useResumeWorkHistoryLimit: () => useResumeWorkHistoryLimitMock(),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'hr' }),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    GET: (...args: unknown[]) => apiGetMock(...args),
  },
}))

const mockT = (key: string, fallback?: string | { defaultValue?: string; [name: string]: unknown }) => {
      if (typeof fallback === 'string') {
        return fallback
      }
      const template = fallback?.defaultValue ?? key
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(fallback?.[name] ?? `{{${name}}}`))
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} {...props}>{children}</div>,
  DialogDescription: ({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} {...props}>{children}</div>,
  DialogFooter: ({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} {...props}>{children}</div>,
  DialogHeader: ({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} {...props}>{children}</div>,
  DialogTitle: ({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} {...props}>{children}</div>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  buttonVariants: () => '',
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

vi.mock('@/components/AiFeedbackButtons', () => ({
  AiFeedbackButtons: () => null,
}))

vi.mock('@/hooks/useCompanyPolicyIndex', () => ({
  useCompanyPolicyIndex: () => ({
    aliasIndex: new Map(),
    loading: false,
    error: null,
    load: vi.fn(),
    hasPolicies: false,
    matchResume: () => [],
  }),
}))

describe('ResumeDetail work history', () => {
  beforeEach(() => {
    useResumeWorkHistoryLimitMock.mockReturnValue({ limit: 3, setLimit: vi.fn() })
    useAuthMock.mockReturnValue({ memberships: [] })
    apiGetMock.mockResolvedValue({ data: { success: true, data: { targets: [] } } })
  })

  it('renders the full materialized approved evidence revision surface', () => {
    render(
      <ResumeDetail
        open
        onOpenChange={vi.fn()}
        resume={{
          name: 'Alice',
          profileUrl: 'https://example.com/resume-1',
          activityStatus: 'Active',
          age: '30',
          experience: '5 years',
          education: 'Bachelor',
          location: 'Malaysia',
          selfIntro: 'Test intro',
          jobIntention: 'Sales Engineer',
          expectedSalary: '10k-20k',
          workHistory: [],
          extractedAt: '2026-03-13T00:00:00.000Z',
          resumeId: 'resume-1',
          ingestData: {
            verifiedIndustryEvidenceSummaries: [{
              companyKey: 'acme-cnc',
              companyName: 'Acme CNC',
              industryClass: 'cnc',
              verificationLevel: 'verified',
              verdictRevisionId: 'revision-1',
              evidenceSummary: 'Human-approved CNC machinery evidence.',
              reviewedAt: Date.UTC(2026, 6, 20),
              reviewedBy: 'Reviewer A',
              sourceCount: 0,
              sourcePreviews: [],
            }],
          },
        } as unknown as ResumeItem}
      />,
    )

    expect(screen.getByText('Approved industry evidence')).toBeInTheDocument()
    expect(screen.getByText('revision-1')).toBeInTheDocument()
    expect(screen.getByText('Reviewer A')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Request refresh for Acme CNC' })).toBeInTheDocument()
  })

  it('renders only the latest three stored work-history entries by default', () => {
    render(
      <ResumeDetail
        open
        onOpenChange={vi.fn()}
        refreshState={{
          kind: 'both_stale',
          isStale: true,
          ingestStale: true,
          analysisStale: true,
          actions: ['reingest', 'rerun_analysis'],
        }}
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
      />
    )

    expect(screen.getByText('Current Co')).toBeInTheDocument()
    expect(screen.getByText('Current Role')).toBeInTheDocument()
    expect(screen.getByText('Recent Co')).toBeInTheDocument()
    expect(screen.getByText('Recent Role')).toBeInTheDocument()
    expect(screen.getByText('Middle Co')).toBeInTheDocument()
    expect(screen.getByText('Middle Role')).toBeInTheDocument()
    expect(screen.queryByText('Oldest Co')).not.toBeInTheDocument()
    expect(screen.queryByText('Old Role')).not.toBeInTheDocument()
    expect(screen.getByText('Needs refresh')).toBeInTheDocument()
  })

  it('renders the configured number of latest work-history entries', () => {
    useResumeWorkHistoryLimitMock.mockReturnValue({ limit: 4, setLimit: vi.fn() })

    render(
      <ResumeDetail
        open
        onOpenChange={vi.fn()}
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
      />,
    )

    expect(screen.getByText('Oldest Co')).toBeInTheDocument()
    expect(screen.getByText('Old Role')).toBeInTheDocument()
  })

  it('filters placeholder-only and education-like rows from work history', () => {
    render(
      <ResumeDetail
        open
        onOpenChange={vi.fn()}
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
            { raw: '(2年11月)' },
            { raw: '(11月)' },
            { raw: '2020~2023广东南方职业学院商务英语本科' },
            {
              raw: '2019-04 ~ 至今 (6年11月) 东莞宝力机械 销售经理 负责机床销售与客户维护',
              companyName: '东莞宝力机械',
              jobTitle: '销售经理',
              startDate: '2019-04',
              endDate: '至今',
              description: '负责机床销售与客户维护',
            },
          ],
          extractedAt: '2026-03-13T00:00:00.000Z',
        }}
      />,
    )

    expect(screen.getByText('东莞宝力机械')).toBeInTheDocument()
    expect(screen.getByText('销售经理')).toBeInTheDocument()
    expect(screen.queryByText('(2年11月)')).not.toBeInTheDocument()
    expect(screen.queryByText('(11月)')).not.toBeInTheDocument()
    expect(screen.queryByText('2020~2023广东南方职业学院商务英语本科')).not.toBeInTheDocument()
  })

  it('renders raw Seek date labels when structured start/end dates are missing', () => {
    render(
      <ResumeDetail
        open
        onOpenChange={vi.fn()}
        resume={{
          name: 'Nicole Lim',
          profileUrl: 'https://example.com/nicole-lim',
          activityStatus: 'Active',
          age: '31',
          experience: '8 years',
          education: 'Bachelor',
          location: 'Malaysia',
          selfIntro: '',
          jobIntention: 'Sales Manager',
          expectedSalary: '12k-18k',
          workHistory: [
            {
              raw: 'Sales Manager · TERRAN LLC. · Jul 2012 - Present (14 years 4 months)',
              companyName: 'TERRAN LLC.',
              jobTitle: 'Sales Manager',
              description: 'Led orthopedics implant sales.',
            },
          ],
          extractedAt: '2026-03-13T00:00:00.000Z',
        }}
      />,
    )

    expect(screen.getByText('TERRAN LLC.')).toBeInTheDocument()
    expect(screen.getByText('Sales Manager')).toBeInTheDocument()
    expect(screen.getByText('Jul 2012 - Present (14 years 4 months)')).toBeInTheDocument()
    expect(screen.getByText('Led orthopedics implant sales.')).toBeInTheDocument()
  })

  it('keeps excluded presentation fields hidden when expanded', async () => {
    const user = userEvent.setup()

    render(
      <ResumeDetail
        open
        onOpenChange={vi.fn()}
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
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Expand' }))

    expect(screen.queryByText('Sales Engineer')).not.toBeInTheDocument()
    expect(screen.queryByText('Test intro')).not.toBeInTheDocument()
  })

  it('uses tablet-friendly responsive layout classes for the detail surface', async () => {
    const user = userEvent.setup()

    render(
      <ResumeDetail
        open
        onOpenChange={vi.fn()}
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
          score: 84,
          recommendation: 'strong_match',
          highlights: ['Strong CNC background'],
          concerns: ['Limited region coverage'],
          summary: 'Strong overall fit.',
          matchedAt: '2026-03-13T00:00:00.000Z',
          breakdown: {
            skills: 90,
            experience: 88,
            industry: 85,
            stability: 70,
            location: 65,
          },
        }}
      />,
    )

    const content = screen.getByTestId('resume-detail-content')

    expect(content.className).toContain('md:max-w-3xl')
    expect(content.className).toContain('lg:max-w-4xl')

    await user.click(screen.getByRole('button', { name: 'Expand' }))

    expect(screen.getByTestId('resume-detail-primary-grid').className).toContain('sm:grid-cols-2')
    expect(screen.getByTestId('resume-detail-expanded-grid').className).toContain('sm:grid-cols-2')
    expect(screen.getByTestId('resume-detail-breakdown-grid').className).toContain('grid-cols-2')
    expect(screen.getByTestId('resume-detail-breakdown-grid').className).toContain('md:grid-cols-3')
    expect(screen.getByTestId('resume-detail-breakdown-grid').className).toContain('xl:grid-cols-5')
  })

  it('keeps repeated-title work-history evidence attached to the correct employer', () => {
    render(
      <ResumeDetail
        open
        onOpenChange={vi.fn()}
        resume={{
          name: 'Nicole Lim',
          profileUrl: 'https://example.com/nicole-lim',
          activityStatus: 'Active',
          age: '31',
          experience: '8 years',
          education: 'Bachelor',
          location: 'Malaysia',
          selfIntro: '',
          jobIntention: 'Sales Manager',
          expectedSalary: '12k-18k',
          workHistory: [
            { companyName: 'TERRAN LLC.', jobTitle: 'Sales Manager', startDate: '2019-01', endDate: '2020-06', raw: 'TERRAN LLC. Sales Manager' },
            { companyName: 'Symmetry Medical Malaysia Sdn. Bhd.', jobTitle: 'Sales Manager', startDate: '2020-07', endDate: '2022-08', raw: 'Symmetry Medical Malaysia Sdn. Bhd. Sales Manager' },
            { companyName: 'CNC Mechatronics Sdn. Bhd.', jobTitle: 'Sales Manager', startDate: '2022-09', endDate: '至今', raw: 'CNC Mechatronics Sdn. Bhd. Sales Manager' },
          ],
          ingestData: {
            evidenceText: '',
            industryTags: ['machine tools'],
            synonymHits: ['cnc'],
            brandHits: [],
            companyHits: ['CNC Mechatronics Sdn. Bhd.'],
            industryDbV2Raw: 10,
            experienceLevel: 'mid',
            computedAt: 1,
            skillsVersion: 1,
            ruleScores: {},
            verifiedRoleYears: { sales: 5.4 },
            roleSignals: [
              {
                type: 'sales',
                matchedSignals: ['sales'],
                signalCount: 3,
                occurrences: 3,
                years: 9.1,
                roleRelevantYears: 9.1,
                industryVerifiedYears: 5.4,
                industryVerifiedRelevantYears: 5.4,
                verifyIn: 'workHistory',
                matchedWorkEntries: [
                  {
                    companyName: 'TERRAN LLC.',
                    jobTitle: 'Sales Manager',
                    years: 1.5,
                    industryVerified: false,
                    directRoleMatch: true,
                    matchedSignals: ['TERRAN-SALES'],
                  },
                  {
                    companyName: 'Symmetry Medical Malaysia Sdn. Bhd.',
                    jobTitle: 'Sales Manager',
                    years: 2.2,
                    industryVerified: false,
                    directRoleMatch: true,
                    matchedSignals: ['SYMMETRY-SALES'],
                  },
                  {
                    companyName: 'CNC Mechatronics Sdn. Bhd.',
                    companyKey: 'cnc-mechatronics',
                    jobTitle: 'Sales Manager',
                    years: 5.4,
                    industryVerified: true,
                    verdictRevisionId: 'revision-cnc-mechatronics',
                    directRoleMatch: true,
                    matchedSignals: ['CNC-SALES'],
                  },
                ],
              },
            ],
            verifiedIndustryEvidenceSummaries: [{
              companyKey: 'cnc-mechatronics',
              companyName: 'CNC Mechatronics Sdn. Bhd.',
              industryClass: 'cnc',
              verificationLevel: 'verified',
              verdictRevisionId: 'revision-cnc-mechatronics',
              evidenceSummary: 'Human-approved CNC machinery evidence.',
              reviewedAt: Date.UTC(2026, 6, 20),
              sourceCount: 0,
              additionalSourceCount: 0,
              sourcePreviews: [],
            }],
          },
          extractedAt: '2026-03-13T00:00:00.000Z',
        }}
      />,
    )

    // Locate each work-history card by its unique matched-signal badge; the
    // company text alone would also match the verified-evidence section.
    const terranCard = screen.getByText('TERRAN-SALES').closest('li')
    const symmetryCard = screen.getByText('SYMMETRY-SALES').closest('li')
    const cncCard = screen.getByText('CNC-SALES').closest('li')

    expect(terranCard).not.toBeNull()
    expect(symmetryCard).not.toBeNull()
    expect(cncCard).not.toBeNull()

    const terran = within(terranCard!)
    const symmetry = within(symmetryCard!)
    const cnc = within(cncCard!)

    expect(terran.getByText('TERRAN-SALES')).toBeInTheDocument()
    expect(terran.queryByText('SYMMETRY-SALES')).not.toBeInTheDocument()
    expect(terran.queryByText('CNC-SALES')).not.toBeInTheDocument()
    expect(terran.queryByText('Industry verified')).not.toBeInTheDocument()
    expect(terran.getByText(/1\.5/)).toBeInTheDocument()
    expect(terran.queryByText(/5\.4/)).not.toBeInTheDocument()

    expect(symmetry.getByText('SYMMETRY-SALES')).toBeInTheDocument()
    expect(symmetry.queryByText('TERRAN-SALES')).not.toBeInTheDocument()
    expect(symmetry.queryByText('CNC-SALES')).not.toBeInTheDocument()
    expect(symmetry.queryByText('Industry verified')).not.toBeInTheDocument()
    expect(symmetry.getByText(/2\.2/)).toBeInTheDocument()
    expect(symmetry.queryByText(/5\.4/)).not.toBeInTheDocument()

    expect(cnc.getByText('CNC-SALES')).toBeInTheDocument()
    expect(cnc.queryByText('TERRAN-SALES')).not.toBeInTheDocument()
    expect(cnc.queryByText('SYMMETRY-SALES')).not.toBeInTheDocument()
    expect(cnc.getByText('Industry verified')).toBeInTheDocument()
    expect(cnc.getByText(/5\.4/)).toBeInTheDocument()
  })

  it('shows a revisionless rules signal neutrally and gives only a system admin the attended review path', () => {
    useAuthMock.mockReturnValue({
      memberships: [{ workspaceSlug: 'dev', role: 'admin' }],
    })

    render(
      <ResumeDetail
        open
        onOpenChange={vi.fn()}
        resume={{
          name: 'Vision Candidate',
          profileUrl: 'https://example.com/vision-candidate',
          activityStatus: 'Active',
          age: '31',
          experience: '4 years',
          education: 'Bachelor',
          location: 'Malaysia',
          selfIntro: '',
          jobIntention: 'CNC Sales',
          expectedSalary: '8k-12k',
          workHistory: [{
            companyName: 'Vision Machine Tools',
            jobTitle: 'Sales Engineer',
            startDate: '2022-01',
            endDate: '至今',
            raw: 'Vision Machine Tools Sales Engineer',
          }],
          ingestData: {
            computedAt: 1,
            evidenceText: '',
            industryTags: ['cnc'],
            companyHits: [],
            experienceLevel: 'mid',
            skillsVersion: 1,
            ruleScores: {},
            roleSignals: [{
              type: 'sales',
              matchedSignals: ['CNC-SALES'],
              signalCount: 1,
              occurrences: 1,
              years: 3.5,
              industryVerifiedYears: 3.5,
              verifyIn: 'workHistory',
              matchedWorkEntries: [{
                companyName: 'Vision Machine Tools',
                jobTitle: 'Sales Engineer',
                years: 3.5,
                industryVerified: true,
                matchedSignals: ['CNC-SALES'],
              }],
            }],
          },
          extractedAt: '2026-03-13T00:00:00.000Z',
        } as unknown as ResumeItem}
      />,
    )

    expect(screen.queryByText('Industry verified')).not.toBeInTheDocument()
    expect(screen.getByText('Legacy rules signal')).toBeInTheDocument()
    expect(screen.getByText('Industry evidence needs human review')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review industry evidence' }))
      .toHaveAttribute('href', '/admin/system/settings/industry-verification?status=ready_for_review')
  })

  it('links a Convex resume to its exact industry-review target without employer-name matching', async () => {
    useAuthMock.mockReturnValue({
      memberships: [{ workspaceSlug: 'dev', role: 'admin' }],
    })
    apiGetMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          targets: [{
            workEntryKey: 'vision-work-entry',
            employerLabel: 'Vision Machine Tools',
            availability: 'target_available',
            proposalId: 'industry-maintenance-vision',
            status: 'new',
          }, {
            workEntryKey: 'vision-work-entry-promotion',
            employerLabel: 'Vision Machine Tools',
            availability: 'target_available',
            proposalId: 'industry-maintenance-vision',
            status: 'new',
          }],
        },
      },
    })

    render(
      <ResumeDetail
        open
        onOpenChange={vi.fn()}
        resume={{
          name: 'Vision Candidate',
          profileUrl: 'https://example.com/vision-candidate',
          activityStatus: 'Active',
          age: '31',
          experience: '4 years',
          education: 'Bachelor',
          location: 'Malaysia',
          selfIntro: '',
          jobIntention: 'CNC Sales',
          expectedSalary: '8k-12k',
          workHistory: [{
            companyName: 'Vision Machine Tools',
            jobTitle: 'Sales Engineer',
            startDate: '2022-01',
            endDate: '至今',
            raw: 'Vision Machine Tools Sales Engineer',
          }],
          resumeId: 'resume-convex-1',
          externalId: 'seek:vision-1',
          crawledAt: 1,
          source: 'seek',
          tags: [],
          ingestData: {
            computedAt: 1,
            evidenceText: '',
            industryTags: ['cnc'],
            companyHits: [],
            experienceLevel: 'mid',
            skillsVersion: 1,
            ruleScores: {},
            roleSignals: [{
              type: 'sales',
              matchedSignals: ['CNC-SALES'],
              signalCount: 1,
              occurrences: 1,
              years: 3.5,
              industryVerifiedYears: 3.5,
              verifyIn: 'workHistory',
              matchedWorkEntries: [{
                companyName: 'Vision Machine Tools',
                jobTitle: 'Sales Engineer',
                workEntryFingerprint: 'vision-work-entry',
                years: 3.5,
                industryVerified: true,
                matchedSignals: ['CNC-SALES'],
              }],
            }],
          },
          extractedAt: '2026-03-13T00:00:00.000Z',
        } as unknown as ResumeItem}
      />,
    )

    const reviewLink = await screen.findByRole('link', { name: /Review Vision Machine Tools/i })
    expect(apiGetMock).toHaveBeenCalledWith('/api/resumes/resume-convex-1/industry-review-targets')
    expect(reviewLink).toHaveAttribute(
      'href',
      '/admin/system/settings/industry-verification/proposals/industry-maintenance-vision',
    )
  })

  it('guides an active-workspace reviewer to the workspace review inbox for legacy signals', () => {
    useAuthMock.mockReturnValue({
      memberships: [{ userId: 'u1', workspaceSlug: 'hr', role: 'reviewer' }],
    })

    render(
      <ResumeDetail
        open
        onOpenChange={vi.fn()}
        resume={{
          name: 'Alice',
          profileUrl: 'https://example.com/resume-1',
          activityStatus: 'Active',
          age: '30',
          experience: '5 years',
          education: 'Bachelor',
          location: 'Malaysia',
          selfIntro: 'Test intro',
          jobIntention: 'Sales Engineer',
          expectedSalary: '10k-20k',
          workHistory: [],
          extractedAt: '2026-03-13T00:00:00.000Z',
          resumeId: 'resume-1',
          ingestData: {
            evidenceText: '',
            industryTags: ['cnc'],
            synonymHits: [],
            brandHits: [],
            companyHits: [],
            industryDbV2Raw: 0,
            experienceLevel: 'mid',
            computedAt: 1,
            skillsVersion: 1,
            ruleScores: {},
            roleSignals: [{
              type: 'sales',
              matchedSignals: ['CNC Sales'],
              signalCount: 1,
              occurrences: 1,
              years: 3,
              industryVerifiedYears: 3,
              verifyIn: 'workHistory',
              matchedWorkEntries: [{
                companyName: 'Vision Machine Tools',
                jobTitle: 'Sales Engineer',
                years: 3,
                industryVerified: true,
                matchedSignals: ['CNC Sales'],
              }],
            }],
            verifiedIndustryEvidenceSummaries: [],
          },
        } as unknown as ResumeItem}
      />,
    )

    expect(screen.getByRole('link', { name: 'Review industry evidence' }))
      .toHaveAttribute('href', '/hr/system/settings/industry-verification?status=ready_for_review')
  })

  it('hides legacy review guidance from plain members', () => {
    useAuthMock.mockReturnValue({
      memberships: [{ userId: 'u1', workspaceSlug: 'hr', role: 'user' }],
    })

    render(
      <ResumeDetail
        open
        onOpenChange={vi.fn()}
        resume={{
          name: 'Alice',
          profileUrl: 'https://example.com/resume-1',
          activityStatus: 'Active',
          age: '30',
          experience: '5 years',
          education: 'Bachelor',
          location: 'Malaysia',
          selfIntro: 'Test intro',
          jobIntention: 'Sales Engineer',
          expectedSalary: '10k-20k',
          workHistory: [],
          extractedAt: '2026-03-13T00:00:00.000Z',
          resumeId: 'resume-1',
          ingestData: {
            evidenceText: '',
            industryTags: ['cnc'],
            synonymHits: [],
            brandHits: [],
            companyHits: [],
            industryDbV2Raw: 0,
            experienceLevel: 'mid',
            computedAt: 1,
            skillsVersion: 1,
            ruleScores: {},
            roleSignals: [{
              type: 'sales',
              matchedSignals: ['CNC Sales'],
              signalCount: 1,
              occurrences: 1,
              years: 3,
              industryVerifiedYears: 3,
              verifyIn: 'workHistory',
              matchedWorkEntries: [{
                companyName: 'Vision Machine Tools',
                jobTitle: 'Sales Engineer',
                years: 3,
                industryVerified: true,
                matchedSignals: ['CNC Sales'],
              }],
            }],
            verifiedIndustryEvidenceSummaries: [],
          },
        } as unknown as ResumeItem}
      />,
    )

    expect(screen.queryByText('Industry evidence needs human review')).not.toBeInTheDocument()
  })
})
