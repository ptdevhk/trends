import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CompanyPolicyBadges } from './CompanyPolicyBadges'
import type { CompanyPolicyMatchHit } from '@trends/shared'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}))

const noHireHit: CompanyPolicyMatchHit = {
  companyKey: 'pro-technic-machinery',
  displayName: '宝力机械 / Pro-Technic Machinery',
  matchedEmployer: '东莞宝力机械',
  preset: 'no_hire',
  effects: {
    visibility: 'hide',
    workflow: 'blocked',
    rankingEffect: 'band_known_bad',
  },
  rankingEffect: 'band_known_bad',
}

describe('CompanyPolicyBadges', () => {
  it('renders no-hire badge and banner without implying score change', () => {
    render(<CompanyPolicyBadges hits={[noHireHit]} />)
    expect(screen.getByTestId('company-policy-badge-no-hire')).toBeInTheDocument()

    render(<CompanyPolicyBadges hits={[noHireHit]} variant="banner" />)
    expect(screen.getByTestId('company-policy-warning')).toBeInTheDocument()
    expect(screen.getAllByText(/AI score is unchanged/i).length).toBeGreaterThan(0)
  })
})
