import { expect, test, type Page } from '@playwright/test'
import { isRecord } from "@trends/shared";

type BlockItem = {
  _id: string
  identityKey: string
  workspaceSlug: string
  reason?: string
  blockedBy?: string
  blockedAt: number
}

async function mockAuthenticatedDevShell(page: Page) {
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

  await page.route('**/api/config/resume-field-usage-policy', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        source: 'system',
        policy: {
          version: 1,
          fields: {},
          updatedAt: '2026-07-05T00:00:00.000Z',
        },
      }),
    })
  })

  await page.route('**/api/industry/brand-display-map', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  })
}


async function mockBlocksApi(page: Page, initialItems: BlockItem[]) {
  let items = [...initialItems]
  let listRequestCount = 0
  const patchPayloads: Array<{ identityKey: string; reason?: string }> = []
  const deletedIdentityKeys: string[] = []

  await page.route('**/api/blocks**', async (route) => {
    const request = route.request()
    const method = request.method()
    const url = new URL(request.url())

    if (method === 'GET') {
      listRequestCount += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          items,
        }),
      })
      return
    }

    if (method === 'PATCH') {
      const body = request.postDataJSON()
      if (!isRecord(body) || typeof body.identityKey !== 'string') {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ success: false }),
        })
        return
      }

      const nextReason = typeof body.reason === 'string' ? body.reason : undefined
      patchPayloads.push({ identityKey: body.identityKey, reason: nextReason })
      items = items.map((item) =>
        item.identityKey === body.identityKey
          ? { ...item, reason: nextReason }
          : item
      )

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, updated: true }),
      })
      return
    }

    if (method === 'DELETE') {
      const identityKey = url.searchParams.get('identityKey') ?? ''
      deletedIdentityKeys.push(identityKey)
      const before = items.length
      items = items.filter((item) => item.identityKey !== identityKey)

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          removed: before !== items.length,
        }),
      })
      return
    }

    await route.fulfill({
      status: 405,
      contentType: 'application/json',
      body: JSON.stringify({ success: false }),
    })
  })

  return {
    getItems: () => items,
    getListRequestCount: () => listRequestCount,
    patchPayloads,
    deletedIdentityKeys,
  }
}

test.describe('Blacklist page', () => {
  test('inline reason edit sends PATCH and updates row', async ({ page }) => {
    await mockAuthenticatedDevShell(page)
    const { patchPayloads, getListRequestCount } = await mockBlocksApi(page, [
      {
        _id: 'block-1',
        identityKey: 'candidate-1',
        workspaceSlug: 'dev',
        reason: 'initial reason',
        blockedBy: 'tester',
        blockedAt: 1_700_000_000_000,
      },
    ])

    await page.goto('/dev/settings/policies')
    await page.waitForLoadState('networkidle')
    await expect.poll(() => getListRequestCount()).toBeGreaterThan(0)
    await expect(page.getByTestId('blacklist-page')).toBeVisible()
    const row = page.locator('[data-testid="blacklist-row"][data-identity-key="candidate-1"]')
    await expect(row).toBeVisible()

    await row.getByTestId('blacklist-reason-display').click()
    const reasonInput = row.getByTestId('blacklist-reason-input')
    await reasonInput.fill('updated reason')
    await reasonInput.press('Enter')

    await expect(row.getByTestId('blacklist-reason-display')).toHaveText('updated reason')
    await expect.poll(() => patchPayloads.length).toBe(1)
    expect(patchPayloads[0]).toEqual({
      identityKey: 'candidate-1',
      reason: 'updated reason',
    })
  })

  test('bulk unblock sends DELETE per selected row and removes rows', async ({ page }) => {
    await mockAuthenticatedDevShell(page)
    const { deletedIdentityKeys, getItems, getListRequestCount } = await mockBlocksApi(page, [
      {
        _id: 'block-1',
        identityKey: 'candidate-1',
        workspaceSlug: 'dev',
        reason: 'r1',
        blockedBy: 'tester',
        blockedAt: 1_700_000_000_000,
      },
      {
        _id: 'block-2',
        identityKey: 'candidate-2',
        workspaceSlug: 'dev',
        reason: 'r2',
        blockedBy: 'tester',
        blockedAt: 1_700_000_000_001,
      },
    ])

    await page.goto('/dev/settings/policies')
    await page.waitForLoadState('networkidle')
    await expect.poll(() => getListRequestCount()).toBeGreaterThan(0)
    await expect(page.getByTestId('blacklist-page')).toBeVisible()
    await expect(page.locator('[data-testid="blacklist-row"]')).toHaveCount(2)

    await page
      .locator('[data-testid="blacklist-row"][data-identity-key="candidate-1"] [data-testid="blacklist-row-checkbox"]')
      .click()
    await page
      .locator('[data-testid="blacklist-row"][data-identity-key="candidate-2"] [data-testid="blacklist-row-checkbox"]')
      .click()

    await page.getByTestId('blacklist-bulk-unblock').click()

    await expect.poll(() => deletedIdentityKeys.length).toBe(2)
    expect(deletedIdentityKeys).toEqual(['candidate-1', 'candidate-2'])
    await expect(page.locator('[data-testid="blacklist-row"]')).toHaveCount(0)
    expect(getItems()).toEqual([])
  })
})
