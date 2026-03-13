import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ResumeCard } from './ResumeCard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
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
          { brand: 'fanuc', context: 'equipment', source: 'workHistory' },
          { brand: 'fanuc', context: 'sales', source: 'selfIntro' },
          { brand: 'fanuc', context: 'employer', source: 'workHistory' },
        ]}
      />
    )

    expect(screen.getAllByText('发那科')).toHaveLength(1)
    expect(screen.queryByText('debugIngest.brandContext.equipment')).not.toBeInTheDocument()
    expect(screen.queryByText('debugIngest.brandContext.sales')).not.toBeInTheDocument()
    expect(screen.queryByText(/workHistory/i)).not.toBeInTheDocument()
  })
})
