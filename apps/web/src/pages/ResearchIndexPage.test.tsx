import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ResearchIndexPage } from './ResearchIndexPage'

const getMock = vi.fn()
const postMock = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ workspaceSlug: 'hr' }),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    GET: (...args: unknown[]) => getMock(...args),
    POST: (...args: unknown[]) => postMock(...args),
  },
}))

const showcasePayload = {
  success: true,
  golden: [
    {
      companyKey: 'pro-technic-machinery',
      displayName: '宝力机械 / Pro-Technic',
      kindCounts: { hiring_signal: 1, sales_trigger: 1, market_move: 1 },
      signalCount: 3,
      showcase: true,
      href: '/hr/research/pro-technic-machinery?persona=hr',
    },
    {
      companyKey: 'polywell',
      displayName: 'Polywell',
      kindCounts: { hiring_signal: 1 },
      signalCount: 1,
      showcase: true,
      href: '/hr/research/polywell?persona=hr',
    },
  ],
  fromResumeDesk: [
    {
      companyKey: 'globalfoundries',
      displayName: 'GlobalFoundries',
      kindCounts: { hiring_signal: 1 },
      signalCount: 1,
      showcase: true,
      href: '/hr/research/globalfoundries?persona=hr',
    },
  ],
  pulse: [{ title: 'Pulse headline', platform: 'showcase', capturedAt: 1 }],
  meta: { lastIngest: null, showcaseSeedVersion: 'v1', seedIngestRunId: 'showcase-seed-v1' },
}

describe('ResearchIndexPage hub', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
    getMock.mockImplementation(async (path: string) => {
      if (path === '/api/research/showcase') {
        return { data: showcasePayload }
      }
      return { data: { success: true, items: [] } }
    })
    postMock.mockResolvedValue({ data: { success: true } })
  })

  it('App still mounts research index route', () => {
    const source = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8')
    expect(source).toContain('path="research"')
    expect(source).toContain('ResearchIndexPage')
  })

  it('renders golden and resume-desk cards with persona=hr hrefs and showcase label', async () => {
    render(
      <MemoryRouter>
        <ResearchIndexPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('research-section-golden')).toBeInTheDocument()
    })

    const cards = screen.getAllByTestId('showcase-company-card')
    expect(cards.length).toBeGreaterThanOrEqual(3)
    const pro = cards.find((el) => el.getAttribute('data-company-key') === 'pro-technic-machinery')
    expect(pro).toBeTruthy()
    expect(pro).toHaveAttribute('href', '/hr/research/pro-technic-machinery?persona=hr')
    expect(screen.getAllByTestId('showcase-data-badge').length).toBeGreaterThan(0)
    expect(screen.getByTestId('research-pulse-item')).toHaveTextContent('Pulse headline')
  })

  it('seed CTA posts to showcase seed endpoint', async () => {
    render(
      <MemoryRouter>
        <ResearchIndexPage />
      </MemoryRouter>,
    )
    await waitFor(() => expect(getMock).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('research-seed-showcase'))
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        '/api/research/showcase/seed',
        expect.objectContaining({ body: {} }),
      )
    })
  })
})
