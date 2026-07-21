import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ResearchIndexPage } from './ResearchIndexPage'

const getMock = vi.fn()
const postMock = vi.fn()
const putMock = vi.fn()

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
    PUT: (...args: unknown[]) => putMock(...args),
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
  // Showcase may still return pulse; hub 市场动态 uses dedicated pulse endpoint.
  pulse: [
    {
      title: 'Showcase pulse (unused for section)',
      platform: 'showcase',
      capturedAt: Date.now() - 60_000,
    },
  ],
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

const defaultKeywords = [
  '数控',
  '加工中心',
  '五轴',
  '机床',
  '发那科',
  '马扎克',
  '牧野',
  '创世纪',
  '乔锋',
  '宝力机械',
]

const keywordsPayload = {
  success: true,
  seed: {
    version: 'v1',
    groups: [
      { id: 'cnc-core', label: '数控机床', keywords: ['数控', '加工中心', '五轴', '机床'] },
      { id: 'brands', label: '重点品牌', keywords: ['发那科', '马扎克', '牧野', '创世纪', '乔锋', '宝力机械'] },
    ],
    defaultKeywords,
  },
  workspace: { version: 1 as const, enabled: [] as string[], excluded: [] as string[], custom: [] as string[] },
  effective: defaultKeywords,
}

const pulseWithItems = {
  success: true,
  items: [
    {
      title: '发那科加工中心扩产',
      platform: 'weibo',
      capturedAt: Date.now() - 60_000,
      matchedKeywords: ['发那科', '加工中心'],
    },
    {
      title: '牧野机床订单',
      platform: 'zhihu',
      capturedAt: Date.now() - 120_000,
      matchedKeywords: ['牧野', '机床'],
    },
  ],
  meta: {
    filtered: true,
    effectiveKeywords: defaultKeywords,
    rawCount: 40,
    matchedCount: 2,
  },
}

const pulseSoftEmpty = {
  success: true,
  items: [] as Array<{
    title: string
    platform: string
    capturedAt: number
    matchedKeywords: string[]
  }>,
  meta: {
    filtered: true,
    effectiveKeywords: defaultKeywords,
    rawCount: 40,
    matchedCount: 0,
  },
}

const pulseAllItems = {
  success: true,
  items: [
    {
      title: '娱乐热榜无关新闻',
      platform: 'weibo',
      capturedAt: Date.now() - 30_000,
      matchedKeywords: [] as string[],
    },
    {
      title: '另一条未命中',
      platform: 'zhihu',
      capturedAt: Date.now() - 90_000,
      matchedKeywords: [] as string[],
    },
  ],
  meta: {
    filtered: false,
    effectiveKeywords: defaultKeywords,
    rawCount: 40,
    matchedCount: 40,
  },
}

function mockGetDefault(pulsePayload: typeof pulseWithItems | typeof pulseSoftEmpty = pulseWithItems) {
  getMock.mockImplementation(async (path: string, options?: { params?: { query?: Record<string, unknown> } }) => {
    if (path === '/api/research/showcase') {
      return { data: showcasePayload }
    }
    if (path === '/api/research/industry') {
      return { data: industryPayload }
    }
    if (path === '/api/research/pulse/keywords') {
      return { data: keywordsPayload }
    }
    if (path === '/api/research/pulse') {
      const all = options?.params?.query?.all
      if (all === 1 || all === '1' || all === true) {
        return { data: pulseAllItems }
      }
      return { data: pulsePayload }
    }
    return { data: { success: true, items: [] } }
  })
}

describe('ResearchIndexPage hub', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
    putMock.mockReset()
    mockGetDefault(pulseWithItems)
    postMock.mockResolvedValue({ data: { success: true } })
    putMock.mockResolvedValue({
      data: {
        ...keywordsPayload,
        workspace: { version: 1, enabled: [], excluded: ['签约'], custom: ['刀塔'] },
        effective: [...defaultKeywords.filter((k) => k !== '签约'), '刀塔'],
      },
    })
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

    await waitFor(() => {
      const pulseItems = screen.getAllByTestId('research-pulse-item')
      expect(pulseItems[0]).toHaveTextContent('发那科加工中心扩产')
    })
    const platforms = screen.getAllByTestId('research-pulse-platform')
    expect(platforms[0]).toHaveTextContent('weibo')
    expect(screen.getAllByTestId('research-pulse-time').length).toBeGreaterThan(0)

    // Predictive search combobox is primary in 搜索企业
    const searchInput = screen.getByTestId('research-company-search')
    expect(searchInput).toHaveAttribute('role', 'combobox')
    expect(screen.getByTestId('research-predict-root')).toBeInTheDocument()
    expect(screen.getByTestId('research-company-search-submit')).toBeInTheDocument()

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

  it('loads dedicated pulse + keywords and renders effective chips (first 8 +N)', async () => {
    render(
      <MemoryRouter>
        <ResearchIndexPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith('/api/research/pulse', expect.anything())
    })
    expect(getMock).toHaveBeenCalledWith('/api/research/pulse/keywords')

    await waitFor(() => {
      expect(screen.getByTestId('research-pulse-chips')).toBeInTheDocument()
    })

    const chips = screen.getAllByTestId('research-pulse-chip')
    expect(chips).toHaveLength(8)
    expect(chips[0]).toHaveTextContent('数控')
    expect(screen.getByTestId('research-pulse-chips-more')).toHaveTextContent('+2')
    expect(screen.getByTestId('research-manage-keywords')).toHaveTextContent('管理关键词')
  })

  it('soft empty when matchedCount===0 && rawCount>0; 显示全部 refetches all=1', async () => {
    mockGetDefault(pulseSoftEmpty)

    render(
      <MemoryRouter>
        <ResearchIndexPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('research-pulse-soft-empty')).toBeInTheDocument()
    })
    expect(screen.getByTestId('research-pulse-soft-empty')).toHaveTextContent(
      '当前关键词未命中近期资讯',
    )
    expect(screen.queryByTestId('research-pulse-item')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('research-pulse-show-all'))

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith(
        '/api/research/pulse',
        expect.objectContaining({
          params: expect.objectContaining({
            query: expect.objectContaining({ all: 1 }),
          }),
        }),
      )
    })

    await waitFor(() => {
      expect(screen.getByText('娱乐热榜无关新闻')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('research-pulse-soft-empty')).not.toBeInTheDocument()
  })

  it('chip click temporarily focuses one keyword client-side until cleared', async () => {
    render(
      <MemoryRouter>
        <ResearchIndexPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getAllByTestId('research-pulse-item').length).toBe(2)
    })

    const fanucChip = screen
      .getAllByTestId('research-pulse-chip')
      .find((el) => el.getAttribute('data-keyword') === '发那科')
    expect(fanucChip).toBeTruthy()
    fireEvent.click(fanucChip!)

    await waitFor(() => {
      const items = screen.getAllByTestId('research-pulse-item')
      expect(items).toHaveLength(1)
      expect(items[0]).toHaveTextContent('发那科加工中心扩产')
    })
    expect(fanucChip).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('research-pulse-clear-focus')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('research-pulse-clear-focus'))
    await waitFor(() => {
      expect(screen.getAllByTestId('research-pulse-item').length).toBe(2)
    })
  })

  it('管理关键词 save PUTs then refreshes pulse; cancel discards', async () => {
    render(
      <MemoryRouter>
        <ResearchIndexPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('research-manage-keywords')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('research-manage-keywords'))

    await waitFor(() => {
      expect(screen.getByTestId('pulse-keywords-dialog')).toBeInTheDocument()
    })

    const dialog = screen.getByTestId('pulse-keywords-dialog')
    expect(within(dialog).getByText('默认词')).toBeInTheDocument()
    expect(within(dialog).getAllByTestId('pulse-keyword-default-toggle').length).toBeGreaterThan(0)

    // Uncheck first default → goes to excluded on save
    const firstToggle = within(dialog).getAllByTestId(
      'pulse-keyword-default-toggle',
    )[0] as HTMLInputElement
    expect(firstToggle.checked).toBe(true)
    fireEvent.click(firstToggle)
    expect(firstToggle.checked).toBe(false)

    fireEvent.change(within(dialog).getByTestId('pulse-keyword-custom-input'), {
      target: { value: '刀塔' },
    })
    fireEvent.click(within(dialog).getByTestId('pulse-keyword-custom-add'))
    expect(within(dialog).getByTestId('pulse-keyword-custom-chip')).toHaveTextContent('刀塔')

    const pulseCallsBefore = getMock.mock.calls.filter((c) => c[0] === '/api/research/pulse').length

    fireEvent.click(within(dialog).getByTestId('pulse-keywords-save'))

    await waitFor(() => {
      expect(putMock).toHaveBeenCalledWith(
        '/api/research/pulse/keywords',
        expect.objectContaining({
          body: expect.objectContaining({
            excluded: expect.arrayContaining(['数控']),
            custom: expect.arrayContaining(['刀塔']),
          }),
        }),
      )
    })

    await waitFor(() => {
      expect(screen.queryByTestId('pulse-keywords-dialog')).not.toBeInTheDocument()
    })

    await waitFor(() => {
      const pulseCallsAfter = getMock.mock.calls.filter((c) => c[0] === '/api/research/pulse').length
      expect(pulseCallsAfter).toBeGreaterThan(pulseCallsBefore)
    })
  })

  it('search section renders predictive combobox with listbox on focus', async () => {
    render(
      <MemoryRouter>
        <ResearchIndexPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('research-section-search')).toBeInTheDocument()
    })

    const input = screen.getByTestId('research-company-search')
    expect(input).toHaveAttribute('role', 'combobox')
    fireEvent.focus(input)

    // Empty focus: showcase golden suggestions when no recent opens
    await waitFor(() => {
      expect(screen.getByTestId('research-predict-listbox')).toBeInTheDocument()
    })
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
