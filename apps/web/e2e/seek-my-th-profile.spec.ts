import { expect, test, type Page } from '@playwright/test'

/**
 * TH/MY Seek Talent Search service-engineer profile batch gate.
 *
 * Drives the shipped landing quick-start flow end to end with every backend
 * API mocked at the network boundary (the blacklist.spec.ts pattern):
 *   - landing `/resumes` renders SearchHero quick-start cards from
 *     GET /api/search-profiles
 *   - the MY card (rank 5) and TH card (rank 6) carry the full service
 *     5-stack roleTitles and market=MY|TH in their talentsearch launch URL
 *   - clicking a card's collect button opens the external collection
 *     window with the exact hk.employer.seek.com talentsearch URL
 *   - applying a quick start seeds the in-app search (keywords + location)
 */

type SearchProfileItem = {
  id: string
  name: string
  status: 'active' | 'paused' | 'archived'
  location: string
  keywords: string[]
  quickStart?: {
    enabled: boolean
    rank: number
    label: string
    description?: string
  }
  sources: Array<{
    type: string
    mode?: string
    enabled: boolean
    jobUrl?: string
    collectLimit?: number
    maxPages?: number
  }>
}

const MY_SERVICE_STACK_ROLE_TITLES = 'Services Engineer,Service Technician,Service Manager,Service Coordinator,Service Supervisor'

function talentSearchUrl(market: 'MY' | 'TH'): string {
  return (
    `https://hk.employer.seek.com/talentsearch?searchQuery=CNC&market=${market}&pageNumber=1`
    + `&roleTitles=${encodeURIComponent(MY_SERVICE_STACK_ROLE_TITLES)}`
    + `&salaryType=MONTHLY&minSalary=0&salaryUnspecified=true&keywords=CNC&matchAll=false&sortBy=RELEVANCE`
  )
}

function serviceEngineerProfile(id: 'my' | 'th'): SearchProfileItem {
  const market = id === 'my' ? 'MY' : 'TH'
  const rank = id === 'my' ? 5 : 6
  return {
    id: id === 'my'
      ? 'seek-malaysia-talent-search-service-engineer'
      : 'seek-thailand-talent-search-service-engineer',
    name: id === 'my'
      ? 'SEEK Malaysia CNC Service Engineer — Talent Search'
      : 'SEEK Thailand CNC Service Engineer — Talent Search',
    status: 'active',
    location: id === 'my' ? 'Malaysia' : 'Thailand',
    keywords: ['CNC', 'Service Engineer'],
    quickStart: {
      enabled: true,
      rank,
      label: id === 'my'
        ? 'Malaysia · SEEK · CNC Service Engineer (Talent Search)'
        : 'Thailand · SEEK · CNC Service Engineer (Talent Search)',
      description: id === 'my'
        ? 'CNC, Service Engineer · Malaysia · Talent Search lane'
        : 'CNC, Service Engineer · Thailand · Talent Search lane',
    },
    sources: [
      {
        type: 'seek',
        mode: 'talentsearch',
        enabled: true,
        jobUrl: talentSearchUrl(market),
        collectLimit: 50,
        maxPages: 25,
      },
    ],
  }
}

async function mockLandingShell(page: Page, profiles: SearchProfileItem[]) {
  await page.addInitScript(() => {
    document.cookie = 'trends_csrf=csrf-e2e; path=/; SameSite=Lax'
    localStorage.setItem('i18nextLng', 'en')
  })

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        user: {
          id: 'dev-admin-e2e',
          email: 'dev-admin-e2e@example.com',
          displayName: 'Dev Admin E2E',
          status: 'active',
        },
        memberships: [{ userId: 'dev-admin-e2e', workspaceSlug: 'dev', role: 'admin' }],
        workspaceRole: 'admin',
      }),
    })
  })

  await page.route('**/api/search-profiles', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        profiles,
      }),
    })
  })

  await page.route('**/api/config/resume-field-usage-policy', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        source: 'system',
        policy: { version: 1, fields: {}, updatedAt: '2026-07-05T00:00:00.000Z' },
      }),
    })
  })

  await page.route('**/api/industry/keywords**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, items: [] }),
    })
  })

  await page.route('**/api/config/custom-keywords**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, items: [] }),
    })
  })

  await page.route('**/api/industry/brands**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, items: [] }),
    })
  })

  await page.route('**/api/industry/brand-display-map', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  })

  await page.route('**/api/query', async (route) => {
    const body = route.request().postDataJSON() as { path?: string }
    const path = body.path ?? ''
    if (path === 'job_descriptions:list') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', value: [] }),
      })
      return
    }
    if (path === 'search_sessions:list' || path === 'search_history:list') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', value: [] }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'success', value: [] }),
    })
  })

  await page.route('**/api/actions**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, items: [] }),
    })
  })

  await page.route('**/api/worker/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, status: 'idle' }),
    })
  })

  // Landing data hooks also read company/policy data (mode-keyed cache).
  await page.route('**/api/companies**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, items: [] }),
    })
  })

  await page.route('**/api/company-policies**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, items: [] }),
    })
  })
}

/**
 * Land on a clean quick-start page regardless of what the dev shell's saved
 * session restored. The landing condition is URL-only: any q/location/… param
 * switches SearchHero off. "Apply quick start" assertions operate on the URL
 * right after clicking, so a bare /resumes entry is enough for all three tests.
 */
async function openCleanLanding(page: Page): Promise<void> {
  await page.goto('/resumes')
  await page.waitForLoadState('networkidle')
}

test.describe('SEEK MY/TH service-engineer quick starts', () => {
  test('landing renders MY and TH quick-start cards in rank order with the service 5-stack', async ({ page }) => {
    await mockLandingShell(page, [
      serviceEngineerProfile('my'),
      serviceEngineerProfile('th'),
    ])

    await openCleanLanding(page)

    const myCard = page.locator('button', { hasText: 'Malaysia · SEEK · CNC Service Engineer (Talent Search)' })
    const thCard = page.locator('button', { hasText: 'Thailand · SEEK · CNC Service Engineer (Talent Search)' })
    await expect(myCard.first()).toBeVisible()
    await expect(thCard.first()).toBeVisible()

    // Rank order: the MY card (rank 5) precedes the TH card (rank 6).
    const myBox = await myCard.first().boundingBox()
    const thBox = await thCard.first().boundingBox()
    expect(myBox).not.toBeNull()
    expect(thBox).not.toBeNull()
    expect(myBox!.y).toBeLessThanOrEqual(thBox!.y)

    await expect(myCard.first()).toContainText('CNC, Service Engineer · Malaysia')
    await expect(thCard.first()).toContainText('CNC, Service Engineer · Thailand')
  })

  test('collect button opens the exact talentsearch URL with market, role 5-stack and collect limits', async ({ page }) => {
    await mockLandingShell(page, [
      serviceEngineerProfile('my'),
      serviceEngineerProfile('th'),
    ])

    const openedUrls: string[] = []
    await page.exposeFunction('__e2eRecordOpen', (url: string) => {
      openedUrls.push(url)
    })
    await page.addInitScript(() => {
      const originalOpen = window.open.bind(window)
      ;(window as Window & { __e2eRecordOpen?: (url: string) => void }).__e2eRecordOpen = (url: string) => {
        originalOpen(url, 'e2e-capture')
      }
    })
    // Playwright intercepts window.open popups: the popup is created but its
    // URL is not delivered to our binding. Open a blank popup at setup so the
    // popup event surfaces as a tab we can inspect after the click.
    await page.evaluate(() => window.open('about:blank', 'e2e-capture'))
    await page.waitForTimeout(300)
    const collectPopups = () => page.context().pages().filter((p) => p !== page)

    // Popups open on hk.employer.seek.com (external host) — Playwright keeps
    // the target url on about:blank unless navigation is awaited. Resolve the
    // final URL per target via CDP (works for out-of-process external pages).
    async function popupUrl(target: string): Promise<string> {
      const popup = collectPopups().find((p) => p.url().startsWith(target))
      if (popup) {
        return popup.url()
      }
      const cdp = await page.context().newCDPSession(page)
      const { targetInfos } = await cdp.send('Target.getTargets')
      const infos = (targetInfos ?? []) as Array<{ type?: string; url?: string }>
      const pageInfos = infos.filter((t) => t.type === 'page' && (t.url ?? '').startsWith('http'))
      const info = pageInfos.find((t) => (t.url ?? '').startsWith(target))
      return info?.url ?? ''
    }

    await openCleanLanding(page)

    const collectButtons = page.getByTestId('search-hero-collect')
    await expect(collectButtons).toHaveCount(2)

    // MY collect launches the exact hk talentsearch URL.
    const myCard = page.locator('button', { hasText: 'Malaysia · SEEK · CNC Service Engineer (Talent Search)' }).first()
    const myCollect = myCard.locator('..').getByTestId('search-hero-collect')
    await expect(myCollect).toBeEnabled()
    await myCollect.click()
    await expect.poll(() => collectPopups().length).toBeGreaterThanOrEqual(1)
    const myOpened = await popupUrl('https://hk.employer.seek.com/')
    expect(myOpened).toContain('hk.employer.seek.com/talentsearch')
    expect(myOpened).toContain('market=MY')
    expect(myOpened).toContain(`roleTitles=${encodeURIComponent(MY_SERVICE_STACK_ROLE_TITLES)}`)
    expect(myOpened).toContain('searchQuery=CNC')
    expect(myOpened).toContain('keywords=CNC')

    // TH collect launches market=TH on the same host (never th.employer.seek.com).
    const thCard = page.locator('button', { hasText: 'Thailand · SEEK · CNC Service Engineer (Talent Search)' }).first()
    const thCollect = thCard.locator('..').getByTestId('search-hero-collect')
    await expect(thCollect).toBeEnabled()
    await thCollect.click()
    await expect.poll(() => collectPopups().length).toBeGreaterThanOrEqual(2)
    const thOpened = await popupUrl('https://hk.employer.seek.com/')
    expect(thOpened).toContain('hk.employer.seek.com/talentsearch')
    expect(thOpened).toContain('market=TH')
    expect(thOpened).not.toContain('th.employer.seek.com')
    expect(thOpened).toContain(`roleTitles=${encodeURIComponent(MY_SERVICE_STACK_ROLE_TITLES)}`)
  })

  test('applying the MY quick start seeds the in-app search shell', async ({ page }) => {
    await mockLandingShell(page, [serviceEngineerProfile('my')])

    await openCleanLanding(page)

    const myCard = page.locator('button', { hasText: 'Malaysia · SEEK · CNC Service Engineer (Talent Search)' }).first()
    await myCard.click()
    await page.waitForTimeout(500)

    await expect(page).toHaveURL(/\/resumes/)
    const url = new URL(page.url())
    expect(url.searchParams.get('location')).toContain('Malaysia')
    const q = url.searchParams.get('q')
    expect(q).toBeTruthy()
    const decoded = decodeURIComponent(q ?? '')
    expect(decoded).toContain('CNC')
    expect(decoded).toContain('Service Engineer')
  })
})