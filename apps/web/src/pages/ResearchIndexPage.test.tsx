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
  useWorkspace: () => ({ slug: 'hr' }),
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
  // Showcase may still return pulse; hub 综合热榜 uses dedicated pulse endpoint.
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

function buildKeywordHits(overrides: Record<string, { hitCount: number; sampleTitles?: string[] }> = {}) {
  return defaultKeywords.map((keyword) => ({
    keyword,
    hitCount: overrides[keyword]?.hitCount ?? 0,
    sampleTitles: overrides[keyword]?.sampleTitles ?? [],
  }))
}

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

const platformsPayload = {
  success: true,
  seed: {
    version: 'v1',
    groups: [
      {
        id: 'general-cn',
        label: '综合热榜',
        platforms: [
          { id: 'weibo', name: '微博' },
          { id: 'zhihu', name: '知乎' },
        ],
      },
      {
        id: 'video-cn',
        label: '视频',
        platforms: [{ id: 'douyin', name: '抖音' }],
      },
    ],
    defaults: ['weibo', 'zhihu'],
    catalogIds: ['weibo', 'zhihu', 'douyin'],
  },
  workspace: { version: 1 as const, enabled: [] as string[], excluded: [] as string[] },
  effective: ['weibo', 'zhihu'],
}

const pulseWithItems = {
  success: true,
  items: [
    {
      title: '发那科加工中心扩产',
      platform: 'weibo',
      url: 'https://example.invalid/test-only/fanuc',
      capturedAt: Date.now() - 60_000,
      matchedKeywords: ['发那科', '加工中心'],
      resolvedCompanies: [{ companyKey: 'fanuc', nameCn: '发那科', nameEn: 'FANUC' }],
    },
    {
      title: '牧野机床订单',
      platform: 'zhihu',
      capturedAt: Date.now() - 120_000,
      matchedKeywords: ['牧野', '机床'],
      resolvedCompanies: [{ companyKey: 'makino', nameCn: '牧野', nameEn: 'MAKINO' }],
    },
  ],
  meta: {
    filtered: true,
    effectiveKeywords: defaultKeywords,
    rawCount: 40,
    matchedCount: 2,
    keywordHits: buildKeywordHits({
      加工中心: { hitCount: 1, sampleTitles: ['发那科加工中心扩产'] },
      机床: { hitCount: 1, sampleTitles: ['牧野机床订单'] },
      发那科: { hitCount: 1, sampleTitles: ['发那科加工中心扩产'] },
      牧野: { hitCount: 1, sampleTitles: ['牧野机床订单'] },
    }),
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
    keywordHits: buildKeywordHits(),
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
    matchedCount: 0,
    keywordHits: buildKeywordHits(),
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
    if (path === '/api/research/platforms') {
      return { data: platformsPayload }
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
    const titleLink = screen.getAllByTestId('research-pulse-title-link')[0]
    expect(titleLink).toHaveAttribute('href', '/hr/research/fanuc?persona=hr')
    expect(titleLink).toHaveAttribute('data-company-key', 'fanuc')
    expect(titleLink).toHaveTextContent('发那科加工中心扩产')
    const sourceLink = screen.getAllByTestId('research-pulse-source-link')[0]
    expect(sourceLink).toHaveAttribute('href', 'https://example.invalid/test-only/fanuc')
    const pulseCompanyLinks = screen.getAllByTestId('research-pulse-company-link')
    expect(pulseCompanyLinks[0]).toHaveAttribute('href', '/hr/research/fanuc?persona=hr')
    expect(pulseCompanyLinks[0]).toHaveTextContent('发那科')

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
    const pulseCall = getMock.mock.calls.find((c) => c[0] === '/api/research/pulse')
    expect(pulseCall?.[1]).toEqual(
      expect.objectContaining({
        params: expect.objectContaining({
          query: expect.objectContaining({ hotlistOnly: 1 }),
        }),
      }),
    )
    expect(getMock).toHaveBeenCalledWith('/api/research/pulse/keywords')
    await waitFor(() => {
      // defaultValue and/or locale research.sectionPulse must be 综合热榜 (not 市场动态)
      const title = screen.getByTestId('research-section-hotlist-title')
      expect(title.textContent).toMatch(/综合热榜|Hotlist|綜合熱榜/)
      expect(title.textContent).not.toContain('市场动态')
    })

    await waitFor(() => {
      expect(screen.getByTestId('research-pulse-chips')).toBeInTheDocument()
    })

    const chips = screen.getAllByTestId('research-pulse-chip')
    expect(chips).toHaveLength(8)
    expect(chips[0]).toHaveTextContent('数控')
    expect(screen.getByTestId('research-pulse-helper-summary')).toHaveTextContent(
      '近期热榜 40 条 · 当前关键词命中 2 条',
    )
    const fanucChipCount = screen.getByTestId('research-pulse-chip-count-fanuc')
    expect(fanucChipCount).toHaveTextContent('1')
    const more = screen.getByTestId('research-pulse-chips-more')
    expect(more).toHaveTextContent('+2')
    expect(more.tagName).toBe('BUTTON')
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('research-manage-keywords')).toHaveTextContent('管理关键词')

    fireEvent.click(screen.getByTestId('research-pulse-helper-toggle'))
    await waitFor(() => {
      expect(screen.getByTestId('research-pulse-helper-list')).toBeInTheDocument()
    })
    expect(screen.getByTestId('research-pulse-helper-item-发那科')).toHaveTextContent(
      '命中 1 条',
    )
    expect(screen.getByTestId('research-pulse-helper-item-发那科')).toHaveTextContent(
      '发那科加工中心扩产',
    )

    fireEvent.click(more)
    await waitFor(() => {
      expect(screen.getAllByTestId('research-pulse-chip').length).toBe(defaultKeywords.length)
    })
    expect(screen.getByTestId('research-pulse-chips-more')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('research-pulse-chips-more')).toHaveTextContent('收起')
  })

  it('places search and pulse above industry catalog for HR scan path', async () => {
    render(
      <MemoryRouter>
        <ResearchIndexPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('research-section-search')).toBeInTheDocument()
      expect(screen.getByTestId('research-section-industry')).toBeInTheDocument()
    })

    const page = screen.getByTestId('research-index-page')
    const order = Array.from(
      page.querySelectorAll(
        '[data-testid="research-section-search"], [data-testid="research-section-pulse"], [data-testid="research-section-golden"], [data-testid="research-section-industry"]',
      ),
    ).map((el) => el.getAttribute('data-testid'))

    expect(order.indexOf('research-section-search')).toBeLessThan(
      order.indexOf('research-section-pulse'),
    )
    expect(order.indexOf('research-section-pulse')).toBeLessThan(
      order.indexOf('research-section-golden'),
    )
    expect(order.indexOf('research-section-golden')).toBeLessThan(
      order.indexOf('research-section-industry'),
    )
  })

  it('collapses industry catalog to preview count with expand control', async () => {
    const manyIndustry = {
      success: true,
      items: Array.from({ length: 20 }, (_, i) => ({
        companyKey: `brand-${i}`,
        nameCn: `品牌${i}`,
        nameEn: `Brand${i}`,
        displayName: `品牌${i}`,
        entityId: `brand:brand-${i}`,
        kind: 'brand',
        type: '加工中心',
        aliases: [],
        cnc: true,
      })),
    }
    getMock.mockImplementation(async (path: string) => {
      if (path === '/api/research/showcase') return { data: showcasePayload }
      if (path === '/api/research/industry') return { data: manyIndustry }
      if (path === '/api/research/pulse/keywords') return { data: keywordsPayload }
      if (path === '/api/research/platforms') return { data: platformsPayload }
      if (path === '/api/research/pulse') return { data: pulseWithItems }
      return { data: { success: true, items: [] } }
    })

    render(
      <MemoryRouter>
        <ResearchIndexPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('research-industry-grid')).toBeInTheDocument()
    })

    expect(screen.getAllByTestId('industry-browse-card')).toHaveLength(12)
    const expand = screen.getByTestId('research-industry-expand')
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(expand)

    await waitFor(() => {
      expect(screen.getAllByTestId('industry-browse-card')).toHaveLength(20)
    })
    expect(screen.getByTestId('research-industry-expand')).toHaveAttribute('aria-expanded', 'true')
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
    expect(screen.getByTestId('research-pulse-helper-summary')).toHaveTextContent(
      '近期热榜 40 条 · 当前关键词命中 0 条',
    )
    expect(screen.queryByTestId('research-pulse-item')).not.toBeInTheDocument()
    expect(screen.getByTestId('research-pulse-show-all')).toHaveTextContent('查看未过滤热榜')

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
    expect(screen.getByTestId('research-pulse-helper-summary')).toHaveTextContent(
      '当前显示未过滤热榜 2/40 条 · 当前关键词命中 0 条',
    )
    expect(screen.queryByTestId('research-pulse-soft-empty')).not.toBeInTheDocument()
  })

  it('hides empty showcase and catalog sections when no data is available', async () => {
    getMock.mockImplementation(async (path: string, options?: { params?: { query?: Record<string, unknown> } }) => {
      if (path === '/api/research/showcase') {
        return {
          data: {
            success: true,
            golden: [],
            fromResumeDesk: [],
            meta: { lastIngest: null, showcaseSeedVersion: 'v1', seedIngestRunId: 'showcase-seed-v1' },
          },
        }
      }
      if (path === '/api/research/industry') {
        return { data: { success: true, items: [] } }
      }
      if (path === '/api/research/pulse/keywords') {
        return { data: keywordsPayload }
      }
      if (path === '/api/research/platforms') {
        return { data: platformsPayload }
      }
      if (path === '/api/research/pulse') {
        const all = options?.params?.query?.all
        if (all === 1 || all === '1' || all === true) {
          return { data: pulseAllItems }
        }
        return { data: pulseWithItems }
      }
      return { data: { success: true, items: [] } }
    })

    render(
      <MemoryRouter>
        <ResearchIndexPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('research-showcase-empty-cta')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('research-section-golden')).not.toBeInTheDocument()
    expect(screen.queryByTestId('research-section-resume-desk')).not.toBeInTheDocument()
    expect(screen.queryByTestId('research-section-industry')).not.toBeInTheDocument()
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

  it('shows effective platform count summary when loaded', async () => {
    render(
      <MemoryRouter>
        <ResearchIndexPage />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('research-platforms-summary')).toBeInTheDocument()
    })
    expect(screen.getByTestId('research-platforms-summary')).toHaveTextContent(/数据源/)
    expect(getMock).toHaveBeenCalledWith('/api/research/platforms')
  })

  it('opens 数据源 dialog and saves platform selection', async () => {
    putMock.mockResolvedValue({
      data: {
        ...platformsPayload,
        workspace: { version: 1, enabled: ['weibo', 'zhihu', 'douyin'], excluded: [] },
        effective: ['weibo', 'zhihu', 'douyin'],
      },
    })
    render(
      <MemoryRouter>
        <ResearchIndexPage />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByTestId('research-platforms-open')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('research-platforms-open'))
    await waitFor(() => expect(screen.getByTestId('research-platforms-dialog')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('research-platform-toggle-douyin'))
    fireEvent.click(screen.getByTestId('research-platforms-save'))
    await waitFor(() => {
      expect(putMock).toHaveBeenCalledWith(
        '/api/research/platforms',
        expect.objectContaining({
          body: expect.objectContaining({
            enabled: expect.arrayContaining(['douyin', 'weibo', 'zhihu']),
          }),
        }),
      )
    })
  })
})
