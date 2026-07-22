import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CompanyResearchPanel, type ResearchSignalView } from './CompanyResearchPanel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key,
  }),
}))

const liveHire: ResearchSignalView = {
  _id: 'live-hire',
  companyKey: 'fanuc',
  kind: 'hiring_signal',
  title: 'live hire',
  capturedAt: 2,
  ingestRunId: 'research-xyz',
  evidence: {
    title: 'live hire',
    platform: 'weibo',
    url: 'https://weibo.com/real/1',
    seenAt: 2,
  },
}

const seedSales: ResearchSignalView = {
  _id: 'seed-sales',
  companyKey: 'fanuc',
  kind: 'sales_trigger',
  title: 'seed sales',
  capturedAt: 9,
  ingestRunId: 'showcase-seed-v1',
  evidence: {
    title: 'seed sales',
    platform: 'showcase',
    url: 'https://showcase.local/x',
    seenAt: 9,
  },
}

describe('CompanyResearchPanel live-first honesty', () => {
  it('shows live-only banner when all signals are showcase', () => {
    render(
      <MemoryRouter>
        <CompanyResearchPanel
          companyKey="fanuc"
          companyName="发那科"
          signals={[seedSales]}
          meta={{ liveCount: 0, showcaseCount: 1, liveFirst: true }}
          persona="hr"
        />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('research-live-empty-banner')).toBeInTheDocument()
    expect(screen.getByTestId('research-section-showcase')).toBeInTheDocument()
    expect(screen.queryByTestId('research-section-live')).not.toBeInTheDocument()
    expect(screen.queryByTestId('company-research-evidence-link')).not.toBeInTheDocument()
    expect(screen.getByTestId('company-research-evidence-seed')).toBeInTheDocument()
  })

  it('renders live section before showcase when both present', () => {
    render(
      <MemoryRouter>
        <CompanyResearchPanel
          companyKey="fanuc"
          signals={[liveHire, seedSales]}
          meta={{ liveCount: 1, showcaseCount: 1, liveFirst: true }}
          persona="hr"
        />
      </MemoryRouter>,
    )
    const live = screen.getByTestId('research-section-live')
    const seed = screen.getByTestId('research-section-showcase')
    expect(live.compareDocumentPosition(seed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('company-research-evidence-link')).toHaveAttribute(
      'href',
      'https://weibo.com/real/1',
    )
  })

  it('shows ZH kind labels on filters and signal badges, not raw hiring_signal tokens', () => {
    render(
      <MemoryRouter>
        <CompanyResearchPanel
          companyKey="fanuc"
          signals={[liveHire, seedSales]}
          meta={{ liveCount: 1, showcaseCount: 1, liveFirst: true }}
          persona="hr"
          selectedKinds={['hiring_signal', 'sales_trigger', 'market_move', 'company_mention']}
          onSelectedKindsChange={() => {}}
        />
      </MemoryRouter>,
    )
    const kindFilter = screen.getByTestId('kind-filter')
    expect(kindFilter).toHaveTextContent('招聘')
    expect(kindFilter).toHaveTextContent('销售')
    expect(kindFilter).toHaveTextContent('市场')
    expect(kindFilter).toHaveTextContent('提及')
    expect(kindFilter.textContent).not.toMatch(/hiring_signal|sales_trigger/)
    const kindBadges = screen.getAllByTestId('company-research-kind-label')
    expect(kindBadges.some((el) => el.textContent === '招聘')).toBe(true)
    expect(kindBadges.some((el) => el.textContent === '销售')).toBe(true)
    expect(screen.getByTestId('research-section-live-count')).toHaveTextContent('(1)')
    expect(screen.getByTestId('research-section-showcase-count')).toHaveTextContent('(1)')
  })

  it('strips raw HTML from summary so UI never shows literal <a href>', () => {
    const withHtmlSummary: ResearchSignalView = {
      ...liveHire,
      summary:
        '<a href="https://news.google.com/rss/articles/ABC?oc=5" target="_blank">提质升级|FANUC</a>&nbsp;<font color="#6f6f6f">nfplus.nfnews.com</font>',
    }
    render(
      <MemoryRouter>
        <CompanyResearchPanel
          companyKey="fanuc"
          signals={[withHtmlSummary]}
          meta={{ liveCount: 1, showcaseCount: 0, liveFirst: true }}
          persona="hr"
        />
      </MemoryRouter>,
    )
    const summary = screen.getByTestId('company-research-summary')
    expect(summary).toHaveTextContent('提质升级|FANUC')
    expect(summary).toHaveTextContent('nfplus.nfnews.com')
    expect(summary.textContent).not.toMatch(/<a\s|href=/)
    expect(screen.getByTestId('company-research-evidence-link')).toHaveAttribute(
      'href',
      'https://weibo.com/real/1',
    )
  })
})
