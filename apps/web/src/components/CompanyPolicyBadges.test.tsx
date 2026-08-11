import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CompanyPolicyBadges, companyResearchHref } from './CompanyPolicyBadges'
import type { CompanyPolicyMatchHit } from '@trends/shared'

const mockT = (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

const noHireHit: CompanyPolicyMatchHit = {
  companyKey: 'pro-technic-machinery',
  displayName: '宝力机械 / Pro-Technic Machinery',
  matchedEmployer: '香港宝力机械有限公司东莞代表处',
  preset: 'no_hire',
  effects: {
    visibility: 'hide',
    workflow: 'blocked',
    rankingEffect: 'band_known_bad',
  },
  rankingEffect: 'band_known_bad',
}

describe('CompanyPolicyBadges', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/hr/resumes')
  })
  afterEach(() => {
    window.history.replaceState({}, '', '/')
  })

  it('renders a short chip without score jargon', () => {
    render(<CompanyPolicyBadges hits={[noHireHit]} />)
    const chip = screen.getByTestId('company-policy-badge-no-hire')
    expect(chip).toHaveTextContent(/No-hire/)
    expect(chip).toHaveTextContent(/宝力机械/)
    expect(chip).not.toHaveTextContent(/AI score/i)
    expect(chip).not.toHaveTextContent(/Operational/i)
    expect(chip).not.toHaveTextContent(/Pro-Technic Machinery/)
  })

  it('badge variant links to research page for company', () => {
    render(<CompanyPolicyBadges hits={[noHireHit]} />)
    const research = screen.getByTestId('company-policy-research-link')
    expect(research).toHaveAttribute(
      'href',
      '/hr/research/pro-technic-machinery?persona=hr',
    )
  })

  it('companyResearchHref uses workspace segment and hr persona', () => {
    window.history.replaceState({}, '', '/hr/resumes')
    expect(companyResearchHref('pro-technic-machinery')).toBe(
      '/hr/research/pro-technic-machinery?persona=hr',
    )
    window.history.replaceState({}, '', '/dev/resumes?q=x')
    expect(companyResearchHref('polywell')).toBe('/dev/research/polywell?persona=hr')
  })

  it('banner is one line with manage link to policies settings', () => {
    render(<CompanyPolicyBadges hits={[noHireHit]} variant="banner" />)
    const banner = screen.getByTestId('company-policy-warning')
    expect(banner).toHaveTextContent(/No-hire/)
    expect(banner).toHaveTextContent(/宝力机械/)
    expect(banner).not.toHaveTextContent(/AI score/i)
    expect(banner).not.toHaveTextContent(/Operational/i)
    const link = screen.getByTestId('company-policy-manage-link')
    expect(link).toHaveAttribute('href', '/hr/settings/policies?tab=companies')
    const research = screen.getByTestId('company-policy-research-link')
    expect(research).toHaveAttribute(
      'href',
      '/hr/research/pro-technic-machinery?persona=hr',
    )
  })
})
