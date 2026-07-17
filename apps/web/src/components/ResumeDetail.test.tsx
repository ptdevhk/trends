import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ResumeDetail } from './ResumeDetail'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) => {
      if (typeof fallback === 'string') {
        return fallback
      }
      return fallback?.defaultValue ?? key
    },
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

describe('ResumeDetail latest work history', () => {
  it('renders only the latest three work history entries', () => {
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
      />
    )

    expect(screen.getByText('Current Co · Current Role')).toBeInTheDocument()
    expect(screen.getByText('Recent Co · Recent Role')).toBeInTheDocument()
    expect(screen.getByText('Middle Co · Middle Role')).toBeInTheDocument()
    expect(screen.queryByText('Oldest Co · Old Role')).not.toBeInTheDocument()
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

    expect(screen.getByText('东莞宝力机械 · 销售经理')).toBeInTheDocument()
    expect(screen.queryByText('(2年11月)')).not.toBeInTheDocument()
    expect(screen.queryByText('(11月)')).not.toBeInTheDocument()
    expect(screen.queryByText('2020~2023广东南方职业学院商务英语本科')).not.toBeInTheDocument()
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
})
