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
      nameCn: '宝力机械',
      nameEn: 'Pro-Technic',
      kindCounts: { hiring_signal: 1, sales_trigger: 1, market_move: 1 },
      signalCount: 3,
      showcase: true,
      href: '/hr/research/pro-technic-machinery?persona=hr',
    },
    {
      companyKey: 'fanuc',
      displayName: '发那科 / FANUC',
      nameCn: '发那科',
      nameEn: 'FANUC',
      kindCounts: { hiring_signal: 1 },
      signalCount: 1,
      showcase: true,
      href: '/hr/research/fanuc?persona=hr',
    },
  ],
  fromResumeDesk: [
    {
      companyKey: 'makino',
      displayName: '牧野 / MAKINO',
      nameCn: '牧野',
      nameEn: 'MAKINO',
      kindCounts: { hiring_signal: 1 },
      signalCount: 1,
      showcase: true,
      href: '/hr/research/makino?persona=hr',
    },
  ],
  pulse: [{ title: 'Pulse headline', platform: 'showcase', capturedAt: 1 }],
  meta: { lastIngest: null, showcaseSeedVersion: 'v1', seedIngestRunId: 'showcase-seed-v1' },
}

const industryPayload = {
  success: true,
  items: [
    {
      companyKey: 'fanuc',
      nameCn: '发那科',
      nameEn: 'FANUC',
      displayName: '发那科 / FANUC',
      entityId: 'brand:fanuc',
      kind: 'brand',
      type: '加工中心/数控车床',
      aliases: ['发那科', 'FANUC'],
      cnc: true,
    },
    {
      companyKey: 'pro-technic-machinery',
      nameCn: '宝力机械',
      nameEn: 'Pro-Technic Machinery',
      displayName: '宝力机械 / Pro-Technic Machinery',
      entityId: 'override:pro-technic-machinery',
      kind: 'override',
      type: '金属切削机床',
      aliases: ['宝力机械'],
      cnc: true,
    },
  ],
}

describe('ResearchIndexPage hub', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
    getMock.mockImplementation(async (path: string) => {
      if (path === '/api/research/showcase') {
        return { data: showcasePayload }
      }
      if (path === '/api/research/industry') {
        return { data: industryPayload }
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

  it('renders golden, CNC desk, industry browse with nameCn-first and showcase label', async () => {
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
    expect(pro).toHaveTextContent('宝力机械')
    expect(screen.getAllByTestId('showcase-data-badge').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('showcase-data-badge')[0]).toHaveTextContent('展示数据')
    expect(screen.getByTestId('research-pulse-item')).toHaveTextContent('Pulse headline')

    await waitFor(() => {
      expect(screen.getByTestId('research-section-industry')).toBeInTheDocument()
    })
    const industryCards = screen.getAllByTestId('industry-browse-card')
    expect(industryCards.length).toBeGreaterThanOrEqual(2)
    const fanuc = industryCards.find((el) => el.getAttribute('data-company-key') === 'fanuc')
    expect(fanuc).toBeTruthy()
    expect(fanuc).toHaveTextContent('发那科')
    expect(fanuc).toHaveAttribute('href', '/hr/research/fanuc?persona=hr')
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
