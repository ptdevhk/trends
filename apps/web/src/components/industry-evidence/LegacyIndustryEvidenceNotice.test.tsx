import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// Module-scope t per repo convention — never an inline arrow in the factory.
const mockT = (key: string, options?: Record<string, unknown>) => {
  const template = typeof options?.defaultValue === 'string' ? options.defaultValue : key
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''))
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}))

import { LegacyIndustryEvidenceNotice } from './LegacyIndustryEvidenceNotice'

describe('LegacyIndustryEvidenceNotice', () => {
  it('defaults the review link to the canonical admin base', () => {
    render(<LegacyIndustryEvidenceNotice showReviewAction />)
    const link = screen.getByRole('link', { name: 'Review industry evidence' })
    expect(link).toHaveAttribute(
      'href',
      '/admin/system/settings/industry-verification?status=ready_for_review',
    )
  })

  it('uses the workspace-scoped base when provided', () => {
    render(
      <LegacyIndustryEvidenceNotice
        showReviewAction
        reviewBasePath="/hr/system/settings/industry-verification"
      />,
    )
    const link = screen.getByRole('link', { name: 'Review industry evidence' })
    expect(link).toHaveAttribute(
      'href',
      '/hr/system/settings/industry-verification?status=ready_for_review',
    )
  })

  it('deep-links a review target under the provided base', () => {
    render(
      <LegacyIndustryEvidenceNotice
        showReviewAction
        reviewBasePath="/hr/system/settings/industry-verification"
        reviewTarget={{ employerLabel: 'ACME', proposalId: 'prop-9' }}
      />,
    )
    const link = screen.getByRole('link', { name: 'Review ACME' })
    expect(link).toHaveAttribute(
      'href',
      '/hr/system/settings/industry-verification/proposals/prop-9',
    )
  })

  it('renders no link without showReviewAction', () => {
    render(<LegacyIndustryEvidenceNotice />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
