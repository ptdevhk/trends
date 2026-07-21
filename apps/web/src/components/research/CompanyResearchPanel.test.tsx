import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CompanyResearchPanel, type ResearchSignalView } from './CompanyResearchPanel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}))

const fixtureSignals: ResearchSignalView[] = [
  {
    _id: '1',
    companyKey: 'pro-technic-machinery',
    kind: 'sales_trigger',
    title: 'Sales item',
    evidence: { title: 'Sales item', platform: 'weibo', seenAt: 1, url: 'https://example.com/s' },
    capturedAt: 1,
  },
  {
    _id: '2',
    companyKey: 'pro-technic-machinery',
    kind: 'hiring_signal',
    title: 'Hire item',
    evidence: { title: 'Hire item', platform: 'rss', seenAt: 2, url: 'https://example.com/h' },
    capturedAt: 2,
  },
  {
    _id: '3',
    companyKey: 'pro-technic-machinery',
    kind: 'company_mention',
    title: 'Mention',
    evidence: { title: 'Mention', platform: 'weibo', seenAt: 3 },
    capturedAt: 3,
  },
]

describe('CompanyResearchPanel', () => {
  it('re-ranks the same fixture signals when persona toggles hr vs sales', () => {
    const onPersonaChange = vi.fn()
    const { rerender } = render(
      <MemoryRouter>
        <CompanyResearchPanel
          companyKey="pro-technic-machinery"
          signals={fixtureSignals}
          persona="hr"
          onPersonaChange={onPersonaChange}
        />
      </MemoryRouter>,
    )

    const listHr = screen.getAllByTestId('company-research-signal')
    expect(listHr.map((el) => el.getAttribute('data-kind'))).toEqual([
      'hiring_signal',
      'company_mention',
      'sales_trigger',
    ])

    fireEvent.click(screen.getByTestId('persona-sales'))
    expect(onPersonaChange).toHaveBeenCalledWith('sales')

    rerender(
      <MemoryRouter>
        <CompanyResearchPanel
          companyKey="pro-technic-machinery"
          signals={fixtureSignals}
          persona="sales"
          onPersonaChange={onPersonaChange}
        />
      </MemoryRouter>,
    )

    const listSales = screen.getAllByTestId('company-research-signal')
    expect(listSales.map((el) => el.getAttribute('data-kind'))).toEqual([
      'sales_trigger',
      'company_mention',
      'hiring_signal',
    ])
  })

  it('shows evidence links when url is present', () => {
    render(
      <MemoryRouter>
        <CompanyResearchPanel
          companyKey="pro-technic-machinery"
          signals={fixtureSignals}
          persona="hr"
        />
      </MemoryRouter>,
    )
    const links = screen.getAllByTestId('company-research-evidence-link')
    expect(links.length).toBeGreaterThan(0)
    expect(links[0]).toHaveAttribute('href', expect.stringContaining('https://'))
  })

  it('filters signals by selected kinds', () => {
    render(
      <MemoryRouter>
        <CompanyResearchPanel
          companyKey="pro-technic-machinery"
          signals={fixtureSignals}
          persona="hr"
          selectedKinds={['hiring_signal']}
          onSelectedKindsChange={() => {}}
        />
      </MemoryRouter>,
    )
    const rows = screen.getAllByTestId('company-research-signal')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveAttribute('data-kind', 'hiring_signal')
  })
})
