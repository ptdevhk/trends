import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ResumeCard } from './ResumeCard'

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

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'hr' }),
}))

describe('ResumeCard brand-hit badges', () => {
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

    expect(screen.getByText('2024-02 ~ 至今 Current Co Current Role')).toBeInTheDocument()
    expect(screen.getByText('2023-01 ~ 2024-01 Recent Co Recent Role')).toBeInTheDocument()
    expect(screen.getByText('2021-01 ~ 2022-01 Middle Co Middle Role')).toBeInTheDocument()
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
})
