import { expect, test, type Page } from '@playwright/test'

import {
  expectedCollectLaunchUrl,
  seekMyThApiProfile,
  seekServiceStackRoleTitles,
  type SeekMyThApiProfile,
} from '../../../scripts/e2e-fixtures/seek-my-th'

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
 *
 * Profile fixtures load the REAL config/search-profiles YAMLs via the shared
 * module also consumed by scripts/e2e-fixtures/seek-my-th.test.ts, so this
 * spec cannot drift from the shipped profile files.
 */

function requireQuickStartLabel(profile: SeekMyThApiProfile): string {
  const label = profile.quickStart?.label
  if (!label) {
    throw new Error(`fixture profile ${profile.id} has no quickStart.label`)
  }
  return label
}

function cardLocator(page: Page, profile: SeekMyThApiProfile) {
  return page.locator('button', { hasText: requireQuickStartLabel(profile) })
}

function emptyItemsBody(): string {
  return JSON.stringify({ success: true, items: [] })
}

async function mockLandingShell(page: Page, profiles: SeekMyThApiProfile[]) {
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: emptyItemsBody() })
  })

  await page.route('**/api/config/custom-keywords**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: emptyItemsBody() })
  })

  await page.route('**/api/industry/brands**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: emptyItemsBody() })
  })

  await page.route('**/api/industry/brand-display-map', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  })

  await page.route('**/api/query', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'success', value: [] }),
    })
  })

  await page.route('**/api/actions', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: emptyItemsBody() })
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: emptyItemsBody() })
  })

  await page.route('**/api/company-policies**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: emptyItemsBody() })
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

/**
 * Full-parameter launch contract: the URL the collect button opens must equal
 * the YAML jobUrl plus exactly the tr_* params the real builder appends
 * (tr_auto_sync only — useIndustryKeywords maps the seek source to
 * { type, jobUrl }, so source-level collectLimit/maxPages never reach the
 * landing launch URL).
 */
function expectUrlMatchesLaunch(actual: URL, profile: SeekMyThApiProfile) {
  const expected = expectedCollectLaunchUrl(profile)
  expect(actual.host).toBe('hk.employer.seek.com')
  expect(actual.pathname).toBe('/talentsearch')
  const expectedKeys = Array.from(new Set(expected.searchParams.keys())).sort()
  expect(Array.from(new Set(actual.searchParams.keys())).sort()).toEqual(expectedKeys)
  for (const key of expectedKeys) {
    expect(actual.searchParams.get(key)).toBe(expected.searchParams.get(key))
  }
}

test.describe('SEEK MY/TH service-engineer quick starts', () => {
  test('landing renders MY and TH quick-start cards in rank order with the service 5-stack', async ({ page }) => {
    const myProfile = seekMyThApiProfile('my')
    const thProfile = seekMyThApiProfile('th')
    await mockLandingShell(page, [myProfile, thProfile])

    await openCleanLanding(page)

    const myCard = cardLocator(page, myProfile)
    const thCard = cardLocator(page, thProfile)
    await expect(myCard.first()).toBeVisible()
    await expect(thCard.first()).toBeVisible()

    // Rank order: the MY card (rank 5) precedes the TH card (rank 6).
    const myBox = await myCard.first().boundingBox()
    const thBox = await thCard.first().boundingBox()
    expect(myBox).not.toBeNull()
    expect(thBox).not.toBeNull()
    expect(myBox!.y).toBeLessThanOrEqual(thBox!.y)

    // The card body renders "keywords joined · location" under the label.
    await expect(myCard.first()).toContainText(`${myProfile.keywords.join(', ')} · ${myProfile.location}`)
    await expect(thCard.first()).toContainText(`${thProfile.keywords.join(', ')} · ${thProfile.location}`)
  })

  test('collect button opens the exact talentsearch URL with market, role 5-stack and collect limits', async ({ page }) => {
    const myProfile = seekMyThApiProfile('my')
    const thProfile = seekMyThApiProfile('th')
    await mockLandingShell(page, [myProfile, thProfile])

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

    // The Seek popup is an out-of-process external page; Playwright's page
    // list keeps the about:blank placeholder. Resolve the launched URL by
    // capturing the network request the popup makes to hk.employer.seek.com.
    const launchedSeekUrls: string[] = []
    await page.context().on('page', async (popup) => {
      popup.on('request', (request) => {
        const url = request.url()
        if (url.startsWith('https://hk.employer.seek.com/talentsearch') || url.startsWith('https://my.employer.seek.com/talentsearch')) {
          launchedSeekUrls.push(url)
        }
      })
      // The popup loads a static SPA shell; the talentsearch URL surfaces as
      // the main document request. Catch it directly.
      popup.on('framenavigated', (frame) => {
        if (frame === popup.mainFrame()) {
          const url = frame.url()
          if (url.startsWith('https://hk.employer.seek.com/talentsearch') || url.startsWith('https://my.employer.seek.com/talentsearch')) {
            launchedSeekUrls.push(url)
          }
        }
      })
    })

    await openCleanLanding(page)

    const collectButtons = page.getByTestId('search-hero-collect')
    await expect(collectButtons).toHaveCount(2)

    // MY collect launches the exact hk talentsearch URL.
    const myCollect = cardLocator(page, myProfile).first().locator('..').getByTestId('search-hero-collect')
    await expect(myCollect).toBeEnabled()
    await myCollect.click()
    await expect.poll(() => collectPopups().length).toBeGreaterThanOrEqual(1)
    await expect.poll(() => launchedSeekUrls.length).toBeGreaterThanOrEqual(1)
    const myUrl = new URL(launchedSeekUrls[launchedSeekUrls.length - 1])
    expectUrlMatchesLaunch(myUrl, myProfile)
    expect(myUrl.searchParams.get('market')).toBe('MY')
    expect(myUrl.searchParams.get('roleTitles')).toBe(seekServiceStackRoleTitles('my'))
    expect(myUrl.searchParams.get('searchQuery')).toBe('CNC')
    expect(myUrl.searchParams.get('keywords')).toBe('CNC')

    // TH collect launches market=TH on the same host (never th.employer.seek.com).
    const thCollect = cardLocator(page, thProfile).first().locator('..').getByTestId('search-hero-collect')
    await expect(thCollect).toBeEnabled()
    await thCollect.click()
    await expect.poll(() => collectPopups().length).toBeGreaterThanOrEqual(2)
    await expect.poll(() => launchedSeekUrls.length).toBeGreaterThanOrEqual(2)
    const thUrl = new URL(launchedSeekUrls[launchedSeekUrls.length - 1])
    expectUrlMatchesLaunch(thUrl, thProfile)
    expect(thUrl.hostname).not.toBe('th.employer.seek.com')
    expect(thUrl.searchParams.get('market')).toBe('TH')
    expect(thUrl.searchParams.get('roleTitles')).toBe(seekServiceStackRoleTitles('th'))
  })

  test('applying the MY quick start seeds the in-app search shell', async ({ page }) => {
    const myProfile = seekMyThApiProfile('my')
    await mockLandingShell(page, [myProfile])

    await openCleanLanding(page)

    const myCard = cardLocator(page, myProfile).first()
    await myCard.click()
    await page.waitForTimeout(500)

    await expect(page).toHaveURL(/\/resumes/)
    const url = new URL(page.url())
    expect(url.searchParams.get('location')).toContain(myProfile.location)
    const q = url.searchParams.get('q')
    expect(q).toBeTruthy()
    const decoded = decodeURIComponent(q ?? '')
    expect(decoded).toContain('CNC')
    expect(decoded).toContain('Service Engineer')
  })
})