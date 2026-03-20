import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ResumeDetail } from './ResumeDetail'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
})
