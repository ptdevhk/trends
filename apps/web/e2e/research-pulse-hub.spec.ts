import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * Research desk hub (ResearchIndexPage) e2e — regression gate for the 66/71
 * UAT's 3 "harness/locale artifacts" so they cannot silently recur:
 *
 *   1. The walk ran on /dev/research but hr-demo lacked `dev` membership and
 *      bounced. Here the route is /hr/research with /api/auth/me mocked to an
 *      `hr`-workspace user, so no host membership seed is required.
 *   2. Headless `Accept-Language: en-US` flipped assertion copy. Here the
 *      locale is pinned via `i18nextLng` localStorage (zh-Hans or en) and copy
 *      is asserted against data-testid text matching the REQUESTED locale.
 *   3. en copy said "feed"; W2-1 fixes chipDualCount to "subscription". Asserted
 *      directly so a regression back to "feed" fails loudly.
 *
 * The API shell is fully mocked (no live backend, no WeRSS, no scrape).
 */

function collectConsoleAndNetworkProblems(page: Page) {
  const problems: string[] = []
  page.on('console', (message) => {
    const text = message.text()
    if (text.includes('example.invalid') || text.includes('ERR_NAME_NOT_RESOLVED')) {
      return
    }
    if (message.type() === 'error' || /missingKey|missing i18n|i18next::translator/i.test(text)) {
      problems.push(`console.${message.type()}: ${text}`)
    }
  })
  page.on('pageerror', (error) => {
    problems.push(`pageerror: ${error.message}`)
  })
  page.on('requestfailed', (request) => {
    const url = request.url()
    if (url.includes('example.invalid')) {
      return
    }
    problems.push(`requestfailed: ${request.method()} ${url} - ${request.failure()?.errorText}`)
  })
  return { problems }
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

type PulseMeta = {
  filtered: boolean
  effectiveKeywords: string[]
  rawCount: number
  matchedCount: number
  hotlistMatchedCount: number
  rssMatchedCount: number
  keywordHits: Array<{
    keyword: string
    hitCount: number
    sampleTitles: string[]
    hotlistHitCount: number
    rssHitCount: number
  }>
}

type PulseItem = {
  title: string
  platform: string
  capturedAt: number
  matchedKeywords: string[]
  url?: string
}

// hotlistOnly=1 payload: 0 hotlist matches but rssMatchedCount>0 → soft-empty.
const HOTLIST_ONLY_META: PulseMeta = {
  filtered: true,
  effectiveKeywords: ['发那科'],
  rawCount: 40,
  matchedCount: 0,
  hotlistMatchedCount: 0,
  rssMatchedCount: 1,
  keywordHits: [
    { keyword: '发那科', hitCount: 0, sampleTitles: [], hotlistHitCount: 0, rssHitCount: 1 },
  ],
}

const RSS_ITEMS: PulseItem[] = [
  {
    title: '发那科推出新一代数控系统',
    platform: 'rss:gnews-fanuc-cn',
    capturedAt: Date.now() - 60_000,
    matchedKeywords: ['发那科'],
  },
  {
    title: '东风科技一体化压铸',
    platform: 'rss:gnews-cnc-machine',
    capturedAt: Date.now() - 120_000,
    matchedKeywords: ['数控'],
  },
]

// hotlistOnly=0 payload: the RSS fallback list (scoped when keyword is present).
const RSS_FALLBACK_META: PulseMeta = {
  filtered: true,
  effectiveKeywords: ['发那科', '数控'],
  rawCount: 50,
  matchedCount: 2,
  hotlistMatchedCount: 0,
  rssMatchedCount: 2,
  keywordHits: [
    { keyword: '发那科', hitCount: 1, sampleTitles: ['发那科推出新一代数控系统'], hotlistHitCount: 0, rssHitCount: 1 },
    { keyword: '数控', hitCount: 2, sampleTitles: ['发那科推出新一代数控系统'], hotlistHitCount: 0, rssHitCount: 2 },
  ],
}

async function mockResearchHubShell(page: Page, locale: 'zh-Hans' | 'en') {
  await page.addInitScript((lng) => {
    document.cookie = 'trends_csrf=csrf-e2e; path=/; SameSite=Lax'
    localStorage.setItem('i18nextLng', lng)
  }, locale)

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const { pathname } = new URL(request.url())

    if (pathname === '/api/auth/me') {
      await json(route, {
        success: true,
        user: { id: 'hr-e2e', email: 'hr-e2e@example.com', displayName: 'HR E2E', status: 'active' },
        memberships: [{ userId: 'hr-e2e', workspaceSlug: 'hr', role: 'user' }],
        workspaceRole: 'user',
      })
      return
    }

    if (pathname === '/api/research/showcase') {
      await json(route, {
        success: true,
        golden: [],
        fromResumeDesk: [],
        pulse: [],
        meta: { lastIngest: null },
      })
      return
    }

    if (pathname === '/api/research/industry') {
      await json(route, { success: true, items: [] })
      return
    }

    if (pathname === '/api/research/pulse/keywords') {
      await json(route, {
        success: true,
        seed: { version: 'v1', groups: [], defaultKeywords: ['发那科'] },
        workspace: { version: 1, enabled: [], excluded: [], custom: [] },
        effective: ['发那科'],
      })
      return
    }

    if (pathname === '/api/research/platforms') {
      await json(route, {
        success: true,
        seed: { version: 'v1', groups: [], defaults: [], catalogIds: [] },
        workspace: { version: 1, enabled: [], excluded: [] },
        effective: [],
      })
      return
    }

    if (pathname === '/api/research/pulse') {
      const params = new URL(request.url()).searchParams
      const hotlistOnly = params.get('hotlistOnly')
      const all = params.get('all')
      const keyword = params.get('keyword')
      if (all === '1') {
        await json(route, { success: true, items: RSS_ITEMS, meta: RSS_FALLBACK_META })
        return
      }
      if (hotlistOnly === '1') {
        await json(route, { success: true, items: [], meta: HOTLIST_ONLY_META })
        return
      }
      // hotlistOnly=0 (fallback): scope to the keyword like the real BFF.
      const scoped =
        typeof keyword === 'string' && keyword
          ? RSS_ITEMS.filter((i) => i.matchedKeywords.includes(keyword))
          : RSS_ITEMS
      await json(route, { success: true, items: scoped, meta: RSS_FALLBACK_META })
      return
    }

    if (pathname === '/api/query') {
      await json(route, { status: 'success', value: [] })
      return
    }

    await json(route, { success: true, items: [] })
  })
}

test.describe('Research desk hub e2e (locale-deterministic, membership-agnostic)', () => {
  test('zh-Hans: soft-empty RSS fallback, honest dual chip, RSS badge, clear-focus returns unscoped rows', async ({
    page,
  }) => {
    const { problems } = collectConsoleAndNetworkProblems(page)
    await mockResearchHubShell(page, 'zh-Hans')

    await page.goto('/hr/research')

    const softEmpty = page.getByTestId('research-pulse-soft-empty')
    await expect(softEmpty).toBeVisible()
    await expect(softEmpty).toContainText('热榜关键词未命中。已显示行业订阅')

    // Chip shows honest dual 热榜/订阅 count (not a fake single hit).
    const fanucChip = page.getByTestId('research-pulse-chip').filter({ hasText: '发那科' })
    await expect(fanucChip).toContainText('热榜 0 · 订阅 1')

    // RSS fallback rows render with data-source=rss.
    await expect(page.getByTestId('research-pulse-item').filter({ hasText: '发那科推出新一代数控系统' })).toHaveAttribute(
      'data-source',
      'rss',
    )
    await expect(page.getByTestId('research-pulse-platform').first()).toHaveText('RSS')

    // Chip click scopes the fallback, clear-focus restores the unscoped rows (A2b leftover).
    await fanucChip.click()
    await expect(page.getByTestId('research-pulse-clear-focus')).toBeVisible()
    await expect(page.getByTestId('research-pulse-item')).toHaveCount(1)
    await page.getByTestId('research-pulse-clear-focus').click()
    await expect(page.getByTestId('research-pulse-item')).toHaveCount(2)
    await expect(page.getByTestId('research-pulse-item').filter({ hasText: '东风科技一体化压铸' })).toBeVisible()

    expect(problems).toEqual([])
  })

  test('en: pinned locale renders English copy with subscription (not feed) on the chip', async ({ page }) => {
    const { problems } = collectConsoleAndNetworkProblems(page)
    await mockResearchHubShell(page, 'en')

    await page.goto('/hr/research')

    const softEmpty = page.getByTestId('research-pulse-soft-empty')
    await expect(softEmpty).toBeVisible()
    await expect(softEmpty).toContainText('No hotlist keyword hits. Showing industry subscriptions')

    // W2-1: en chip must say "subscription", never "feed".
    const fanucChip = page.getByTestId('research-pulse-chip').filter({ hasText: '发那科' })
    await expect(fanucChip).toContainText('hotlist 0 · subscription 1')
    await expect(fanucChip).not.toContainText('feed')

    expect(problems).toEqual([])
  })
})
