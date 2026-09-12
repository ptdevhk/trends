import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  CHANNELS_BRIEFING_FIXTURE,
  CHANNELS_BRIEFING_GOLDEN_URLS,
} from './channels-briefing.fixture'
import {
  ChannelsBriefingPanel,
  type ChannelsBriefing,
} from './ChannelsBriefingPanel'

const postMock = vi.fn()

const mockT = (key: string, options?: { defaultValue?: string } & Record<string, unknown>) => {
  if (options?.defaultValue && typeof options.defaultValue === 'string') {
    return options.defaultValue.replace(
      /\{\{(\w+)\}\}/g,
      (_match: string, varName: string) => String(options[varName] ?? `{{${varName}}}`),
    )
  }
  return key
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'hr' }),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    POST: (...args: unknown[]) => postMock(...args),
  },
}))

function pasteGoldenUrls() {
  fireEvent.change(screen.getByTestId('research-channels-briefing-textarea'), {
    target: { value: CHANNELS_BRIEFING_GOLDEN_URLS.join('\n') },
  })
}

function expectedDate(createtime: number): string {
  const ms = createtime > 1e12 ? createtime : createtime * 1000
  return new Date(ms).toISOString().slice(0, 10)
}

function expectedGeneratedHm(iso: string): string {
  const date = new Date(iso)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

async function renderGeneratedBriefing(
  payload: { success: true; briefing: ChannelsBriefing } = CHANNELS_BRIEFING_FIXTURE,
) {
  postMock.mockResolvedValue({ data: payload })
  render(
    <MemoryRouter>
      <ChannelsBriefingPanel />
    </MemoryRouter>,
  )
  pasteGoldenUrls()
  fireEvent.click(screen.getByTestId('research-channels-briefing-generate'))
  await waitFor(() => {
    expect(screen.getByTestId('research-channels-briefing-result')).toBeInTheDocument()
  })
}

describe('ChannelsBriefingPanel', () => {
  beforeEach(() => {
    postMock.mockReset()
  })

  it('keeps generate disabled on empty paste and does not POST', () => {
    render(
      <MemoryRouter>
        <ChannelsBriefingPanel />
      </MemoryRouter>,
    )

    const generate = screen.getByTestId('research-channels-briefing-generate')
    expect(generate).toBeDisabled()
    fireEvent.click(generate)
    expect(postMock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByTestId('research-channels-briefing-textarea'), {
      target: { value: '   \n  \n' },
    })
    expect(screen.getByTestId('research-channels-briefing-generate')).toBeDisabled()
    expect(postMock).not.toHaveBeenCalled()
  })

  it('renders snap-x sample cards with category and title', () => {
    render(
      <MemoryRouter>
        <ChannelsBriefingPanel />
      </MemoryRouter>,
    )

    const carousel = screen.getByTestId('research-channels-briefing-samples')
    expect(carousel.className).toMatch(/snap-x/)
    expect(screen.getAllByTestId(/research-channels-briefing-sample-card-/)).toHaveLength(4)

    const primary = screen.getByTestId('research-channels-briefing-sample-card-primary')
    expect(primary.className).toMatch(/min-h-\[132px\]/)
    expect(primary).toHaveTextContent('明日简报')
    expect(primary).toHaveTextContent('机床业务')
    const expansion = screen.getByTestId('research-channels-briefing-sample-card-expansion')
    expect(expansion).toHaveTextContent('液冷')
    expect(expansion).toHaveTextContent('扩产')
    const connector = screen.getByTestId('research-channels-briefing-sample-card-connector')
    expect(connector).toHaveTextContent('液冷')
    expect(connector).toHaveTextContent('接头')
    const dieCast = screen.getByTestId('research-channels-briefing-sample-card-die-cast')
    expect(dieCast).toHaveTextContent('压铸')
    expect(dieCast).toHaveTextContent('第二曲线')
  })

  it('clicking the primary sample card POSTs the three golden URLs and renders the fixture briefing', async () => {
    postMock.mockResolvedValue({ data: CHANNELS_BRIEFING_FIXTURE })

    render(
      <MemoryRouter>
        <ChannelsBriefingPanel />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByTestId('research-channels-briefing-sample-card-primary'))

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        '/api/research/channels-briefing',
        expect.objectContaining({
          body: { urls: [...CHANNELS_BRIEFING_GOLDEN_URLS] },
        }),
      )
    })
    expect(screen.getByTestId('research-channels-briefing-textarea')).toHaveValue(
      CHANNELS_BRIEFING_GOLDEN_URLS.join('\n'),
    )

    await waitFor(() => {
      expect(screen.getByTestId('research-channels-briefing-one-liner')).toHaveTextContent(
        CHANNELS_BRIEFING_FIXTURE.briefing.oneLiner,
      )
    })
    expect(screen.getAllByTestId('research-channels-briefing-post')).toHaveLength(3)
    expect(screen.getByTestId('research-channels-briefing-weak-signals')).toHaveTextContent(
      '三条都没有点名机床品牌或五轴型号。',
    )
    expect(screen.getByTestId('research-channels-briefing-opportunities')).toHaveTextContent(
      '奇宏电子（AVC）深圳新产线',
    )
  })

  it('clicking a single-link sample card POSTs only that URL', async () => {
    postMock.mockResolvedValue({ data: CHANNELS_BRIEFING_FIXTURE })

    render(
      <MemoryRouter>
        <ChannelsBriefingPanel />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByTestId('research-channels-briefing-sample-card-expansion'))

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        '/api/research/channels-briefing',
        expect.objectContaining({
          body: { urls: [CHANNELS_BRIEFING_GOLDEN_URLS[0]] },
        }),
      )
    })
    expect(screen.getByTestId('research-channels-briefing-textarea')).toHaveValue(
      CHANNELS_BRIEFING_GOLDEN_URLS[0],
    )
  })

  it('POSTs pasted sph URLs and renders the briefing fixture', async () => {
    postMock.mockResolvedValue({ data: CHANNELS_BRIEFING_FIXTURE })

    render(
      <MemoryRouter>
        <ChannelsBriefingPanel />
      </MemoryRouter>,
    )
    pasteGoldenUrls()
    fireEvent.click(screen.getByTestId('research-channels-briefing-generate'))

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        '/api/research/channels-briefing',
        expect.objectContaining({
          body: { urls: [...CHANNELS_BRIEFING_GOLDEN_URLS] },
        }),
      )
    })

    await waitFor(() => {
      expect(screen.getByTestId('research-channels-briefing-one-liner')).toHaveTextContent(
        CHANNELS_BRIEFING_FIXTURE.briefing.oneLiner,
      )
    })

    const posts = screen.getAllByTestId('research-channels-briefing-post')
    expect(posts).toHaveLength(3)
    expect(posts[0]).toHaveTextContent('9月22日23日深圳液冷全产业链展')
    expect(posts[0]).toHaveTextContent('4.5亿！年产1200万套')
    expect(posts[0]).toHaveTextContent('111')
    expect(posts[0]).toHaveTextContent('551')
    const cover = screen.getAllByTestId('research-channels-briefing-cover')[0]
    expect(cover).toHaveAttribute('src', 'https://example.invalid/covers/ALr3ch0zp9.jpg')
    expect(posts[1].querySelector('img')).toBeNull()

    expect(screen.getByTestId('research-channels-briefing-core-trends')).toHaveTextContent(
      '液冷从“概念”变成深圳扩产订单。',
    )
    expect(screen.getByTestId('research-channels-briefing-weak-signals')).toHaveTextContent(
      '三条都没有点名机床品牌或五轴型号。',
    )
    const opportunities = screen.getByTestId('research-channels-briefing-opportunities')
    expect(opportunities).toHaveTextContent('奇宏电子（AVC）深圳新产线')
    expect(opportunities).toHaveTextContent('立加 / 高速钻攻')
    expect(opportunities).toHaveTextContent('年产 1200 万套冷板 + UQD')

    const sources = screen.getAllByTestId('research-channels-briefing-source')
    expect(sources).toHaveLength(3)
    expect(sources[0]).toHaveAttribute('href', 'https://weixin.qq.com/sph/ALr3ch0zp9')
    expect(sources[0]).toHaveAttribute('target', '_blank')
    expect(sources[0]).toHaveAttribute('rel', 'noreferrer')
  })

  it('renders ranked rows in response order with 2-line captions and meta', async () => {
    await renderGeneratedBriefing()

    const posts = screen.getAllByTestId('research-channels-briefing-post')
    const ranks = screen.getAllByTestId('research-channels-briefing-rank')
    expect(ranks.map((node) => node.textContent)).toEqual(['1', '2', '3'])
    expect(posts[0]).toHaveTextContent('4.5亿！年产1200万套')
    expect(posts[1]).toHaveTextContent('40家液冷接头供应商')
    expect(posts[2]).toHaveTextContent('拓普集团上半年营收近142亿元')
    expect(posts[0].querySelector('.line-clamp-2')).toHaveTextContent(
      '4.5亿！年产1200万套，AI散热领域龙头奇宏电子（AVC）深圳扩建AI服务器液冷散热产线！',
    )
    expect(posts[0]).toHaveTextContent('9月22日23日深圳液冷全产业链展')
    expect(posts[0]).toHaveTextContent(expectedDate(1756000000))
    expect(posts[0]).toHaveTextContent('551')
    expect(posts[0]).toHaveTextContent('111')
    expect(screen.getByTestId('research-channels-briefing-result').className).not.toMatch(
      /grid-cols-3/,
    )
  })

  it('does not re-sort posts client-side', async () => {
    const reversed = {
      ...CHANNELS_BRIEFING_FIXTURE,
      briefing: {
        ...CHANNELS_BRIEFING_FIXTURE.briefing,
        posts: [...CHANNELS_BRIEFING_FIXTURE.briefing.posts].reverse(),
      },
    }
    await renderGeneratedBriefing(reversed)

    const posts = screen.getAllByTestId('research-channels-briefing-post')
    const ranks = screen.getAllByTestId('research-channels-briefing-rank')
    expect(ranks.map((node) => node.textContent)).toEqual(['1', '2', '3'])
    expect(posts[0]).toHaveTextContent('拓普集团上半年营收近142亿元')
    expect(posts[1]).toHaveTextContent('40家液冷接头供应商')
    expect(posts[2]).toHaveTextContent('4.5亿！年产1200万套')
  })

  it('shows a 3:4 thumb when coverUrl is present and stays text-only when it is not', async () => {
    await renderGeneratedBriefing()

    const posts = screen.getAllByTestId('research-channels-briefing-post')
    const covers = screen.getAllByTestId('research-channels-briefing-cover')
    expect(covers).toHaveLength(2)
    expect(covers[0]).toHaveAttribute('src', 'https://example.invalid/covers/ALr3ch0zp9.jpg')
    expect(covers[0]).toHaveAttribute('loading', 'lazy')
    expect(covers[0]).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(covers[0].className).toMatch(/aspect-\[3\/4\]/)
    expect(covers[0].className).toMatch(/w-16/)
    expect(covers[0].className).toMatch(/sm:w-21/)
    expect(posts[0].querySelector('[data-testid="research-channels-briefing-cover"]')).not.toBeNull()
    expect(posts[1].querySelector('img')).toBeNull()
    expect(posts[1].querySelector('[class*="aspect-"]')).toBeNull()
    expect(posts[2].querySelector('[data-testid="research-channels-briefing-cover"]')).toHaveAttribute(
      'src',
      'https://example.invalid/covers/Ah85Fcapqh.jpg',
    )
  })

  it('omits the cover image when coverUrl is empty or whitespace', async () => {
    const emptyCover = {
      ...CHANNELS_BRIEFING_FIXTURE,
      briefing: {
        ...CHANNELS_BRIEFING_FIXTURE.briefing,
        posts: [
          {
            ...CHANNELS_BRIEFING_FIXTURE.briefing.posts[0],
            coverUrl: '   ',
          },
        ],
      },
    }
    await renderGeneratedBriefing(emptyCover)

    const posts = screen.getAllByTestId('research-channels-briefing-post')
    expect(posts).toHaveLength(1)
    expect(posts[0].querySelector('img')).toBeNull()
    expect(screen.queryByTestId('research-channels-briefing-cover')).not.toBeInTheDocument()
  })

  it('renders labeled sources as 作者 · 日期, not the raw sph href', async () => {
    await renderGeneratedBriefing()

    const sources = screen.getAllByTestId('research-channels-briefing-source')
    const firstPost = CHANNELS_BRIEFING_FIXTURE.briefing.posts[0]
    expect(sources[0]).toHaveTextContent(firstPost.author)
    expect(sources[0]).toHaveTextContent(expectedDate(firstPost.createtime))
    expect(sources[0]).not.toHaveTextContent(firstPost.url)
    expect(sources[0]).toHaveAttribute('href', firstPost.url)
    expect(sources[0]).toHaveAttribute('rel', 'noreferrer')
    expect(sources[0]).toHaveAttribute('target', '_blank')
  })

  it('shows production header chips for post count and generated time, not sample masthead copy', async () => {
    await renderGeneratedBriefing()

    const chips = screen.getByTestId('research-channels-briefing-header-chips')
    expect(chips).toHaveTextContent('3')
    expect(chips).toHaveTextContent(
      expectedGeneratedHm(CHANNELS_BRIEFING_FIXTURE.briefing.generatedAt),
    )
    expect(screen.getByTestId('research-channels-briefing-post-count')).toHaveTextContent('3')
    expect(screen.getByTestId('research-channels-briefing-generated-at')).toHaveTextContent(
      expectedGeneratedHm(CHANNELS_BRIEFING_FIXTURE.briefing.generatedAt),
    )

    const result = screen.getByTestId('research-channels-briefing-result')
    expect(result).not.toHaveTextContent('机床业务')
    expect(result).not.toHaveTextContent('晨会用')
    expect(result).not.toHaveTextContent('公开封面')
    expect(screen.getByTestId('research-channels-briefing')).toHaveTextContent('不看视频')
    expect(screen.getByTestId('research-channels-briefing-sample-card-primary')).toHaveTextContent(
      '机床业务',
    )
  })

  it('hides the generated-at chip when generatedAt is missing', async () => {
    const withoutGeneratedAt = {
      ...CHANNELS_BRIEFING_FIXTURE,
      briefing: {
        ...CHANNELS_BRIEFING_FIXTURE.briefing,
        generatedAt: undefined,
      },
    }
    await renderGeneratedBriefing(withoutGeneratedAt)

    expect(screen.getByTestId('research-channels-briefing-post-count')).toHaveTextContent('3')
    expect(screen.queryByTestId('research-channels-briefing-generated-at')).not.toBeInTheDocument()
  })

  it('shows a loading state while the briefing request is in flight', async () => {
    let resolvePost: (value: { data: typeof CHANNELS_BRIEFING_FIXTURE }) => void = () => {}
    postMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve
        }),
    )

    render(
      <MemoryRouter>
        <ChannelsBriefingPanel />
      </MemoryRouter>,
    )
    pasteGoldenUrls()
    fireEvent.click(screen.getByTestId('research-channels-briefing-generate'))

    await waitFor(() => {
      expect(screen.getByTestId('research-channels-briefing-loading')).toBeInTheDocument()
    })
    expect(screen.getByTestId('research-channels-briefing-generate')).toBeDisabled()

    resolvePost({ data: CHANNELS_BRIEFING_FIXTURE })
    await waitFor(() => {
      expect(screen.queryByTestId('research-channels-briefing-loading')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('research-channels-briefing-one-liner')).toBeInTheDocument()
  })

  it('shows a 400 error with retry that re-POSTs the same urls', async () => {
    postMock.mockResolvedValue({
      error: { message: 'invalid url' },
      response: { status: 400, ok: false },
    })

    render(
      <MemoryRouter>
        <ChannelsBriefingPanel />
      </MemoryRouter>,
    )
    pasteGoldenUrls()
    fireEvent.click(screen.getByTestId('research-channels-briefing-generate'))

    await waitFor(() => {
      expect(screen.getByTestId('research-channels-briefing-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('research-channels-briefing-error')).toHaveTextContent(
      /These links cannot be used|这些链接不能用/,
    )
    expect(screen.queryByTestId('research-channels-briefing-one-liner')).not.toBeInTheDocument()

    postMock.mockResolvedValue({ data: CHANNELS_BRIEFING_FIXTURE })
    fireEvent.click(screen.getByTestId('research-channels-briefing-retry'))
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(2)
    })
    expect(postMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        body: { urls: [...CHANNELS_BRIEFING_GOLDEN_URLS] },
      }),
    )
    await waitFor(() => {
      expect(screen.getByTestId('research-channels-briefing-one-liner')).toBeInTheDocument()
    })
  })

  it('shows a 502 error with retry', async () => {
    postMock.mockResolvedValue({
      error: { message: 'upstream' },
      response: { status: 502, ok: false },
    })

    render(
      <MemoryRouter>
        <ChannelsBriefingPanel />
      </MemoryRouter>,
    )
    pasteGoldenUrls()
    fireEvent.click(screen.getByTestId('research-channels-briefing-generate'))

    await waitFor(() => {
      expect(screen.getByTestId('research-channels-briefing-error')).toHaveTextContent(
        /Could not read those posts|暂时读不到这些内容/,
      )
    })
    expect(screen.getByTestId('research-channels-briefing-retry')).toBeInTheDocument()
  })

  it('surfaces a generic error and clears loading when the POST transport rejects', async () => {
    postMock.mockRejectedValue(new Error('network down'))

    render(
      <MemoryRouter>
        <ChannelsBriefingPanel />
      </MemoryRouter>,
    )
    pasteGoldenUrls()
    fireEvent.click(screen.getByTestId('research-channels-briefing-generate'))

    await waitFor(() => {
      expect(screen.getByTestId('research-channels-briefing-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('research-channels-briefing-error')).toHaveTextContent(
      /简报生成失败。请重试。/,
    )
    expect(screen.queryByTestId('research-channels-briefing-loading')).not.toBeInTheDocument()
    expect(screen.getByTestId('research-channels-briefing-generate')).not.toBeDisabled()
    expect(screen.queryByTestId('research-channels-briefing-one-liner')).not.toBeInTheDocument()
  })

  it('renders result before operator controls after successful generation, collapsing controls under accessible Update briefing disclosure', async () => {
    await renderGeneratedBriefing()

    const result = screen.getByTestId('research-channels-briefing-result')
    const disclosure = screen.getByTestId('research-channels-briefing-controls-disclosure')
    expect(result).toBeInTheDocument()
    expect(disclosure).toBeInTheDocument()

    // Reader-first: result node appears before disclosure node in DOM
    expect(result.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // Disclosure is collapsed by default after generation
    expect(disclosure).not.toHaveAttribute('open')
    const summary = screen.getByTestId('research-channels-briefing-controls-summary')
    expect(summary).toHaveTextContent(/Update briefing|更新简报/)

    // Operator controls exist inside disclosure
    expect(screen.getByTestId('research-channels-briefing-textarea')).toBeInTheDocument()
    expect(screen.getByTestId('research-channels-briefing-generate')).toBeInTheDocument()
  })

  it('renders research topic handoff link for each core trend using a compact domain keyword', async () => {
    await renderGeneratedBriefing()

    const trendLinks = screen.getAllByTestId('research-channels-briefing-trend-handoff')
    expect(trendLinks).toHaveLength(CHANNELS_BRIEFING_FIXTURE.briefing.coreTrends.length)

    expect(trendLinks[0]).toHaveAttribute('href', '/hr/research?pulse=%E6%B6%B2%E5%86%B7')
    expect(trendLinks[1]).toHaveAttribute('href', '/hr/research?pulse=%E6%8E%A5%E5%A4%B4')
    expect(trendLinks[0]).toHaveTextContent(/Research this topic|研究此热点/)
  })

  it('renders compact resume handoffs and keeps the action label on one line', async () => {
    await renderGeneratedBriefing()

    const oppLinks = screen.getAllByTestId('research-channels-briefing-opportunity-handoff')
    expect(oppLinks).toHaveLength(CHANNELS_BRIEFING_FIXTURE.briefing.opportunities.length)

    expect(oppLinks[0]).toHaveAttribute(
      'href',
      '/hr/resumes?q=%E7%AB%8B%E5%8A%A0&co=%E5%A5%87%E5%AE%8F%E7%94%B5%E5%AD%90%EF%BC%88AVC%EF%BC%89',
    )
    expect(oppLinks[0].className).toMatch(/whitespace-nowrap/)
    expect(oppLinks[0]).toHaveTextContent(/Find candidates|查找候选人/)
  })
})
