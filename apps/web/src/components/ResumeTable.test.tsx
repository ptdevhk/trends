import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ResumeTable } from './ResumeTable'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

describe('ResumeTable field usage policy', () => {
  it('hides job intention values by default on the presentation surface', () => {
    render(
      <ResumeTable
        items={[
          {
            resumeId: 'resume-1',
            name: 'Alice',
            profileUrl: 'https://example.com/resume-1',
            activityStatus: 'Active',
            age: '30',
            experience: '5 years',
            education: 'Bachelor',
            location: 'Dongguan',
            selfIntro: 'Hidden intro',
            jobIntention: 'Sales Engineer',
            expectedSalary: '10k-20k',
            workHistory: [],
            extractedAt: '2026-03-20T00:00:00.000Z',
          },
        ]}
        onViewDetails={vi.fn()}
      />,
    )

    expect(screen.getByText('--')).toBeInTheDocument()
    expect(screen.queryByText('Sales Engineer')).not.toBeInTheDocument()
  })
})
