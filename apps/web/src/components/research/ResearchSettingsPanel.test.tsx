import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  ResearchSettingsPanel,
  type ResearchSettingsPanelProps,
} from './ResearchSettingsPanel'
import type { PulseKeywordsDialogState } from './PulseKeywordsDialog'
import type { HotlistPlatformsDialogState } from './HotlistPlatformsDialog'
import type { NewsSourcesDialogState } from './NewsSourcesDialog'

const mockT = (_key: string, options?: { defaultValue?: string } & Record<string, unknown>) => {
  let text = options?.defaultValue ?? _key
  if (options) {
    for (const [k, v] of Object.entries(options)) {
      if (k === 'defaultValue') continue
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
    }
  }
  return text
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}))

const DOWNSTREAM_KWS = ['压铸', '压铸机', '模具', '五金', '下游']

const keywords = {
  seed: {
    version: 'v1',
    groups: [
      { id: 'downstream-demand', label: '下游工业需求', keywords: DOWNSTREAM_KWS },
      {
        id: 'cnc-core',
        label: '数控机床',
        keywords: ['数控', '机床'],
      },
    ],
    defaultKeywords: DOWNSTREAM_KWS,
  },
  workspace: { version: 1 as const, enabled: [] as string[], excluded: [] as string[], custom: [] as string[] },
  effective: DOWNSTREAM_KWS,
} satisfies PulseKeywordsDialogState

const platforms = {
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
    ],
    defaults: ['weibo', 'zhihu'],
    catalogIds: ['weibo', 'zhihu'],
  },
  workspace: { version: 1 as const, enabled: [] as string[], excluded: [] as string[] },
  effective: ['weibo', 'zhihu'],
} satisfies HotlistPlatformsDialogState

const newsSources = {
  seed: {
    version: 'v1',
    groups: [
      { id: 'brands', label: '重点品牌', feeds: ['gnews-fanuc-cn'] },
      { id: 'mould-diecast', label: '模具/压铸/注塑', feeds: ['gnews-diecast', 'bing-muju'] },
    ],
    catalogIds: ['gnews-fanuc-cn', 'gnews-diecast', 'bing-muju'],
    defaultGroupIds: ['brands', 'mould-diecast'],
  },
  workspace: { version: 1 as const, excludedGroups: [] as string[], excludedFeeds: [] as string[], enabledFeeds: [] as string[] },
  effective: ['gnews-fanuc-cn', 'gnews-diecast', 'bing-muju'],
} satisfies NewsSourcesDialogState

function makeProps(overrides: Partial<ResearchSettingsPanelProps> = {}) {
  const saveKeywords = vi.fn()
  const savePlatforms = vi.fn()
  const saveNewsSources = vi.fn()
  const restore = vi.fn()
  const props: ResearchSettingsPanelProps = {
    realtimeItems: [
      {
        title: '一体化压铸珠三角落地',
        platform: 'rss:gnews-diecast',
        capturedAt: Date.now() - 60_000,
        matchedKeywords: ['压铸'],
      },
      {
        title: '纯数控新闻标题',
        platform: 'rss:gnews-cnc-machine',
        capturedAt: Date.now() - 120_000,
        matchedKeywords: ['数控'],
      },
    ],
    realtimeLoading: false,
    keywords,
    platforms,
    newsSources,
    onSaveKeywords: saveKeywords,
    onSavePlatforms: savePlatforms,
    onSaveNewsSources: saveNewsSources,
    onRestoreDefaults: restore,
    ...overrides,
  }
  return { props, saveKeywords, savePlatforms, saveNewsSources, restore }
}

describe('ResearchSettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders title, realtime (downstream-filtered), keyword tree, cards, actions', () => {
    const { props } = makeProps()
    render(<ResearchSettingsPanel {...props} />)

    expect(screen.getByText('行业研究 / 监控设置')).toBeInTheDocument()
    expect(screen.getByTestId('research-settings-panel')).toBeInTheDocument()

    // 实时新闻 renders ONLY the downstream-matched item, not the 数控-only one
    expect(screen.getByText('实时新闻')).toBeInTheDocument()
    expect(screen.getAllByTestId('research-realtime-item')).toHaveLength(1)
    expect(screen.getByText('一体化压铸珠三角落地')).toBeInTheDocument()
    expect(screen.queryByText('纯数控新闻标题')).not.toBeInTheDocument()
    // matched downstream keyword chip shown
    expect(screen.getByTestId('research-realtime-chip')).toHaveTextContent('压铸')

    // CNC root + 下游需求 default-on
    expect(screen.getAllByText(/CNC/).length).toBeGreaterThan(0)
    expect(screen.getByTestId('research-tree-downstream-default')).toHaveTextContent('默认启用')

    // downstream chips all checked
    const chips = screen.getAllByTestId('research-tree-kw-chip')
    const downChips = chips.filter((c) => c.getAttribute('data-group') === 'downstream-demand')
    expect(downChips.length).toBe(DOWNSTREAM_KWS.length)
    for (const c of downChips) expect(c).toHaveAttribute('aria-pressed', 'true')

    // data source + hotlist cards
    expect(screen.getByText(/数据源 \(/)).toBeInTheDocument()
    expect(screen.getByText(/热榜平台 \(/)).toBeInTheDocument()
    expect(screen.getAllByTestId('research-settings-platform-chip').length).toBeGreaterThan(0)

    expect(screen.getByTestId('research-settings-save')).toHaveTextContent('保存配置')
    expect(screen.getByTestId('research-settings-restore')).toHaveTextContent('恢复默认')
  })

  it('unchecking a downstream keyword removes that item from realtime', async () => {
    const { props } = makeProps()
    render(<ResearchSettingsPanel {...props} />)

    const diecastChip = screen
      .getAllByTestId('research-tree-kw-chip')
      .find((c) => c.getAttribute('data-keyword') === '压铸')!
    fireEvent.click(diecastChip)
    expect(diecastChip).toHaveAttribute('aria-pressed', 'false')

    // The 压铸 item is now filtered out → empty realtime
    expect(screen.queryByText('一体化压铸珠三角落地')).not.toBeInTheDocument()
    expect(screen.getByTestId('research-realtime-empty')).toBeInTheDocument()
  })

  it('保存配置 PUTs keywords (excluded derives from unchecked default), platforms, sources', () => {
    const { props, saveKeywords, savePlatforms, saveNewsSources } = makeProps()
    render(<ResearchSettingsPanel {...props} />)

    // Uncheck 模具 (a default downstream kw) → goes to excluded
    const mujuChip = screen.getAllByTestId('research-tree-kw-chip').find(
      (c) => c.getAttribute('data-keyword') === '模具',
    )!
    fireEvent.click(mujuChip)

    fireEvent.click(screen.getByTestId('research-settings-save'))

    expect(saveKeywords).toHaveBeenCalledTimes(1)
    const kwBody = saveKeywords.mock.calls[0][0]
    expect(kwBody.excluded).toContain('模具')
    expect(kwBody.excluded).not.toContain('压铸')

    expect(savePlatforms).toHaveBeenCalledTimes(1)
    expect(savePlatforms.mock.calls[0][0].enabled).toContain('weibo')

    expect(saveNewsSources).toHaveBeenCalledTimes(1)
  })

  it('restore defaults triggers onRestoreDefaults', () => {
    const { props, restore } = makeProps()
    render(<ResearchSettingsPanel {...props} />)
    fireEvent.click(screen.getByTestId('research-settings-restore'))
    expect(restore).toHaveBeenCalledTimes(1)
  })

  it('collapsed groups expand on click; downstream expanded by default', () => {
    const { props } = makeProps()
    render(<ResearchSettingsPanel {...props} />)

    // cnc-core (数控机床) is collapsed by default (not downstream)
    const cnccore = screen.getByTestId('research-tree-group-cnc-core')
    expect(cnccore).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(cnccore)
    expect(cnccore).toHaveAttribute('aria-expanded', 'true')
    // chips appear in the group body (data-group=cnc-core)
    const cncChip = screen
      .getAllByTestId('research-tree-kw-chip')
      .find((c) => c.getAttribute('data-group') === 'cnc-core' && c.getAttribute('data-keyword') === '数控')
    expect(cncChip).toBeTruthy()
    expect(cncChip).toHaveAttribute('aria-pressed', 'false') // not in downstream default
  })

  it('toggling a data-source type OFF excludes those feeds on save', () => {
    const { props, saveNewsSources } = makeProps()
    render(<ResearchSettingsPanel {...props} />)

    // Bing row (bing-muju) OFF, GNews stays ON
    const bingRow = screen.getByTestId('research-settings-source-bing')
    expect(bingRow).toBeChecked()
    fireEvent.click(bingRow)
    expect(bingRow).not.toBeChecked()

    fireEvent.click(screen.getByTestId('research-settings-save'))

    const body = saveNewsSources.mock.calls[0][0]
    expect(body.excludedFeeds).toContain('bing-muju')
    expect(body.excludedFeeds).not.toContain('gnews-diecast')
    expect(body.masterEnabled).toBe(true)
  })

  it('realtime empty state when no downstream keyword active', () => {
    const { props } = makeProps()
    render(<ResearchSettingsPanel {...props} />)

    // Turn off every downstream keyword
    const chips = screen
      .getAllByTestId('research-tree-kw-chip')
      .filter((c) => c.getAttribute('data-group') === 'downstream-demand')
    for (const c of chips) fireEvent.click(c)

    expect(screen.getByTestId('research-realtime-empty')).toBeInTheDocument()
  })
})
