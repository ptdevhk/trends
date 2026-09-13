import { expect, test, type Page, type Route } from '@playwright/test'

import { CHANNELS_BRIEFING_FIXTURE } from '../src/components/research/channels-briefing.fixture'

type MockBriefingControls = {
  requestUrls: string[]
  release: () => void
  failNextWith502: () => void
}

function collectConsoleAndNetworkProblems(page: Page, options: { allowExpected502?: boolean } = {}) {
  const problems: string[] = []
  page.on('console', (message) => {
    const text = message.text()
    if (
      text.includes('example.invalid')
      || text.includes('ERR_NAME_NOT_RESOLVED')
      || (options.allowExpected502 && text.includes('502 (Bad Gateway)'))
    ) {
      return
    }
    if (
      message.type() === 'error'
      || /missingKey|missing i18n|i18next::translator/i.test(text)
    ) {
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
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

async function mockResearchShell(page: Page): Promise<MockBriefingControls> {
  await page.addInitScript(() => {
    document.cookie = 'trends_csrf=csrf-e2e; path=/; SameSite=Lax'
    localStorage.setItem('i18nextLng', 'zh-Hans')
  })

  let releaseResponse: (() => void) | undefined
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve
  })
  const requestUrls: string[] = []
  let return502Next = false

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const { pathname } = new URL(request.url())

    if (pathname === '/api/auth/me') {
      await json(route, {
        success: true,
        user: {
          id: 'hr-e2e',
          email: 'hr-e2e@example.com',
          displayName: 'HR E2E',
          status: 'active',
        },
        memberships: [{ userId: 'hr-e2e', workspaceSlug: 'hr', role: 'user' }],
        workspaceRole: 'user',
      })
      return
    }

    if (pathname === '/api/research/channels-briefing') {
      const body = request.postDataJSON() as { urls?: unknown }
      requestUrls.push(...(Array.isArray(body.urls) ? body.urls.map(String) : []))
      if (return502Next) {
        return502Next = false
        await json(route, { success: false, error: 'Bad Gateway' }, 502)
        return
      }
      await responseGate
      await json(route, CHANNELS_BRIEFING_FIXTURE)
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
        seed: {
          version: 'v1',
          groups: [],
          defaultKeywords: [],
        },
        workspace: {
          version: 1,
          enabled: [],
          excluded: [],
          custom: [],
        },
        effective: [],
      })
      return
    }

    if (pathname === '/api/research/platforms') {
      await json(route, {
        success: true,
        seed: {
          version: 'v1',
          groups: [],
          defaults: [],
          catalogIds: [],
        },
        workspace: {
          version: 1,
          enabled: [],
          excluded: [],
        },
        effective: [],
      })
      return
    }

    if (pathname === '/api/research/pulse') {
      await json(route, {
        success: true,
        items: [],
        meta: {
          filtered: true,
          effectiveKeywords: [],
          rawCount: 0,
          matchedCount: 0,
          keywordHits: [],
        },
      })
      return
    }

    if (pathname === '/api/query') {
      await json(route, { status: 'success', value: [] })
      return
    }

    await json(route, { success: true, items: [] })
  })

  return {
    requestUrls,
    release: () => releaseResponse?.(),
    failNextWith502: () => {
      return502Next = true
    },
  }
}

test.describe('Sales Channels briefing acceptance flow', () => {
  test('desktop: focus, sample card, keyboard interaction, generate flow, and unexpected failure check', async ({
    page,
  }) => {
    const { problems } = collectConsoleAndNetworkProblems(page)
    const controls = await mockResearchShell(page)

    await page.goto('/hr/research')

    const panel = page.getByTestId('research-channels-briefing')
    const textarea = page.getByTestId('research-channels-briefing-textarea')
    const generate = page.getByTestId('research-channels-briefing-generate')
    const samplePrimary = page.getByTestId('research-channels-briefing-sample-card-primary')

    await expect(panel).toBeVisible()
    await expect(generate).toBeDisabled()

    // Focus and accessibility check
    await samplePrimary.focus()
    await expect(samplePrimary).toBeFocused()

    // Trigger generate using sample card
    await samplePrimary.click()
    await expect(textarea).toHaveValue(/weixin\.qq\.com/)
    await expect(page.getByTestId('research-channels-briefing-loading')).toBeVisible()

    // Release mocked network response
    controls.release()

    // Result rendering check
    await expect(page.getByTestId('research-channels-briefing-result')).toBeVisible()
    await expect(page.getByTestId('research-channels-briefing-one-liner')).toContainText(
      CHANNELS_BRIEFING_FIXTURE.briefing.oneLiner,
    )
    await expect(page.getByTestId('research-channels-briefing-post')).toHaveCount(3)

    // Verify no unexpected console errors or unhandled request failures
    expect(problems).toEqual([])
  })

  test('mobile: viewport responsiveness, handoffs, and retry recovery', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    const { problems } = collectConsoleAndNetworkProblems(page, { allowExpected502: true })
    const controls = await mockResearchShell(page)

    await page.goto('/hr/research')

    const panel = page.getByTestId('research-channels-briefing')
    const textarea = page.getByTestId('research-channels-briefing-textarea')
    const generate = page.getByTestId('research-channels-briefing-generate')

    await expect(panel).toBeVisible()
    await expect(generate).toBeDisabled()
    await expect(page.getByTestId('research-channels-briefing-empty')).toBeVisible()

    // Check mobile panel width fit
    const panelBox = await panel.boundingBox()
    expect(panelBox).not.toBeNull()
    expect(panelBox!.width).toBeLessThanOrEqual(375)

    // Fill valid URL
    await textarea.fill(`  ${CHANNELS_BRIEFING_FIXTURE.briefing.posts[0].url}  \n\n`)
    await expect(generate).toBeEnabled()

    // Trigger failure first to verify retry recovery branch
    controls.failNextWith502()
    await generate.click()

    const errorBox = page.getByTestId('research-channels-briefing-error')
    await expect(errorBox).toBeVisible()
    await expect(errorBox).toContainText('暂时读不到这些内容')

    const retryBtn = page.getByTestId('research-channels-briefing-retry')
    await expect(retryBtn).toBeVisible()

    // Now click retry and release success response
    controls.release()
    await retryBtn.click()

    await expect(page.getByTestId('research-channels-briefing-result')).toBeVisible()
    await expect(page.getByTestId('research-channels-briefing-one-liner')).toContainText(
      CHANNELS_BRIEFING_FIXTURE.briefing.oneLiner,
    )

    // Verify HR candidate handoff href
    const candidateHandoff = page
      .getByTestId('research-channels-briefing-opportunity-handoff')
      .first()
    await expect(candidateHandoff).toHaveAttribute(
      'href',
      '/hr/resumes?q=%E7%AB%8B%E5%8A%A0&co=%E5%A5%87%E5%AE%8F%E7%94%B5%E5%AD%90%EF%BC%88AVC%EF%BC%89',
    )

    // No unexpected console errors
    expect(problems).toEqual([])
  })
})
