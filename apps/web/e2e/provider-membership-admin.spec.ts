import { expect, test, type Page, type Route } from '@playwright/test'
import { isRecord, SYSTEM_SETTINGS_NAV_ITEMS } from '@trends/shared'

type WorkspaceRole = 'user' | 'admin'
type UserKind = 'admin' | 'hr'

type AuthUser = {
  id: string
  email: string
  displayName: string
  status: 'active'
}

type WorkspaceMembership = {
  userId: string
  workspaceSlug: string
  role: WorkspaceRole
}

type ProviderIdentity = {
  provider: 'casdoor'
  providerSubject: string
  providerTenant: string
  userId: string
  email: string
  displayName: string
  updatedAt: string
}

type ProviderPreapproval = {
  provider: 'casdoor'
  providerSubject: string
  providerTenant: string
  workspaceSlug: string
  role: WorkspaceRole
  operatorId: string
  active: boolean
  createdAt: string
  updatedAt: string
  revokedAt?: string
  revokedBy?: string
}

type ProviderGrant = {
  provider: 'casdoor'
  providerSubject: string
  providerTenant: string
  workspaceSlug: string
  role: WorkspaceRole
  userId: string
  preapprovalId: string
  active: boolean
  grantedAt: string
  revokedAt?: string
}

type AuthEvent = {
  id: string
  type: string
  userId?: string
  provider?: string
  workspaceSlug?: string
  createdAt: string
}

type ProviderMembershipRequest = {
  provider: 'casdoor'
  providerSubject: string
  providerTenant: string
  workspaceSlug: string
  role?: WorkspaceRole
}

const now = '2026-06-08T00:00:00.000Z'

const users: Record<UserKind, AuthUser> = {
  admin: {
    id: 'admin-e2e',
    email: 'admin-e2e@example.com',
    displayName: 'Dev Admin E2E',
    status: 'active',
  },
  hr: {
    id: 'hr-e2e',
    email: 'hr-e2e@example.com',
    displayName: 'HR User E2E',
    status: 'active',
  },
}

const memberships: Record<UserKind, WorkspaceMembership[]> = {
  admin: [{ userId: users.admin.id, workspaceSlug: 'dev', role: 'admin' }],
  hr: [{ userId: users.hr.id, workspaceSlug: 'hr', role: 'user' }],
}

function collectConsoleProblems(page: Page) {
  const messages: string[] = []
  page.on('console', (message) => {
    const text = message.text()
    if (
      message.type() === 'error'
      || message.type() === 'warning'
      || /missingKey|missing i18n|i18next::translator/i.test(text)
    ) {
      messages.push(`${message.type()}: ${text}`)
    }
  })
  page.on('pageerror', (error) => {
    messages.push(`pageerror: ${error.message}`)
  })
  return {
    messages,
  }
}

function parseJsonBody(route: Route): unknown {
  try {
    return route.request().postDataJSON()
  } catch {
    return undefined
  }
}

function isProviderMembershipRequest(value: unknown): value is ProviderMembershipRequest {
  if (!isRecord(value)) {
    return false
  }
  return value.provider === 'casdoor'
    && typeof value.providerSubject === 'string'
    && typeof value.providerTenant === 'string'
    && typeof value.workspaceSlug === 'string'
    && (value.role === undefined || value.role === 'user' || value.role === 'admin')
}

function jsonResponse(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

function workspaceFrom(route: Route): string {
  return route.request().headers()['x-workspace-slug'] ?? 'dev'
}

function hasWorkspaceAdminAccess(user: UserKind | null, workspaceSlug: string): boolean {
  return Boolean(user && memberships[user].some((membership) => (
    membership.workspaceSlug === workspaceSlug && membership.role === 'admin'
  )))
}

async function installProviderMembershipApi(page: Page) {
  let currentUser: UserKind | null = null
  const preapproveRequests: ProviderMembershipRequest[] = []
  const revokeRequests: ProviderMembershipRequest[] = []
  const deniedProviderRequests: Array<{ method: string; path: string }> = []
  const identities: ProviderIdentity[] = [
    {
      provider: 'casdoor',
      providerSubject: 'wecom-seeded-42',
      providerTenant: 'wecom-corp-e2e',
      userId: 'provider-user-seeded',
      email: 'wecom-seeded@example.com',
      displayName: 'WeCom E2E Candidate',
      updatedAt: now,
    },
    {
      provider: 'casdoor',
      providerSubject: 'wecom-grant-99',
      providerTenant: 'wecom-corp-e2e',
      userId: 'provider-user-grant',
      email: 'wecom-grant@example.com',
      displayName: 'WeCom Grant Candidate',
      updatedAt: now,
    },
  ]
  const preapprovals: ProviderPreapproval[] = [
    {
      provider: 'casdoor',
      providerSubject: 'wecom-seeded-42',
      providerTenant: 'wecom-corp-e2e',
      workspaceSlug: 'dev',
      role: 'user',
      operatorId: users.admin.id,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
  ]
  const grants: ProviderGrant[] = [
    {
      provider: 'casdoor',
      providerSubject: 'wecom-seeded-42',
      providerTenant: 'wecom-corp-e2e',
      workspaceSlug: 'dev',
      role: 'user',
      userId: 'provider-user-seeded',
      preapprovalId: 'preapproval-seeded',
      active: true,
      grantedAt: now,
    },
  ]
  const events: AuthEvent[] = [
    {
      id: 'event-seeded',
      type: 'workspace_membership_granted',
      provider: 'casdoor',
      userId: 'provider-user-seeded',
      workspaceSlug: 'dev',
      createdAt: now,
    },
  ]

  await page.addInitScript(() => {
    // fetchCurrentAuth short-circuits without the trends_csrf cookie; the
    // real backend sets it via Set-Cookie on login, so the e2e mock must
    // seed it (same pattern as blacklist.spec.ts) to keep auth alive across
    // top-level route shells (/login → /admin/system remounts AuthProvider).
    document.cookie = 'trends_csrf=csrf-e2e; path=/; SameSite=Lax'
    localStorage.setItem('i18nextLng', 'en')
  })

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const method = request.method()
    const { pathname } = new URL(request.url())
    const workspaceSlug = workspaceFrom(route)

    if (pathname === '/api/config/resume-field-usage-policy') {
      await jsonResponse(route, 200, { success: true, config: {} })
      return
    }

    if (pathname === '/api/industry/brand-display-map') {
      await jsonResponse(route, 200, {})
      return
    }

    if (pathname === '/api/config/system-metadata') {
      await jsonResponse(route, 200, {
        success: true,
        metadata: {
          identity: { appVersion: 'e2e' },
          navigation: {
            system: [],
            settings: [],
            systemSettings: SYSTEM_SETTINGS_NAV_ITEMS,
            debugPage: [],
          },
        },
      })
      return
    }

    if (pathname === '/api/auth/login' && method === 'POST') {
      const body = parseJsonBody(route)
      if (
        isRecord(body)
        && body.username === 'admin-e2e'
        && body.password === 'admin-secret'
      ) {
        currentUser = 'admin'
      } else if (
        isRecord(body)
        && body.username === 'hr-e2e'
        && body.password === 'hr-secret'
      ) {
        currentUser = 'hr'
      } else {
        await jsonResponse(route, 401, { success: false, error: 'Invalid username or password' })
        return
      }

      await jsonResponse(route, 200, {
        success: true,
        user: users[currentUser],
        memberships: memberships[currentUser],
        csrfToken: 'csrf-e2e',
        expiresAt: '2026-06-09T00:00:00.000Z',
      })
      return
    }

    if (pathname === '/api/auth/logout' && method === 'POST') {
      currentUser = null
      await jsonResponse(route, 200, { success: true })
      return
    }

    if (pathname === '/api/auth/me') {
      if (!currentUser) {
        await jsonResponse(route, 401, { success: false, error: 'Authentication required' })
        return
      }
      const userMemberships = memberships[currentUser]
      await jsonResponse(route, 200, {
        success: true,
        user: users[currentUser],
        memberships: userMemberships,
        workspaceRole: userMemberships.find((membership) => membership.workspaceSlug === workspaceSlug)?.role ?? null,
      })
      return
    }

    if (pathname === '/api/admin/users' && method === 'GET') {
      // The auth page embeds UsersPanel, which renders users.length.
      await jsonResponse(route, 200, { success: true, users: [] })
      return
    }

    if (pathname === '/api/auth/provider-memberships') {
      if (!hasWorkspaceAdminAccess(currentUser, workspaceSlug)) {
        deniedProviderRequests.push({ method, path: pathname })
        await jsonResponse(route, currentUser ? 403 : 401, {
          success: false,
          error: currentUser ? 'Admin access required' : 'Authentication required',
        })
        return
      }

      await jsonResponse(route, 200, {
        success: true,
        identities,
        preapprovals: preapprovals.filter((preapproval) => preapproval.workspaceSlug === workspaceSlug),
        grants: grants.filter((grant) => grant.workspaceSlug === workspaceSlug),
        events: events.filter((event) => event.workspaceSlug === workspaceSlug),
      })
      return
    }

    if (pathname === '/api/auth/provider-memberships/preapprove' && method === 'POST') {
      if (!hasWorkspaceAdminAccess(currentUser, workspaceSlug)) {
        deniedProviderRequests.push({ method, path: pathname })
        await jsonResponse(route, currentUser ? 403 : 401, {
          success: false,
          error: currentUser ? 'Admin access required' : 'Authentication required',
        })
        return
      }

      const body = parseJsonBody(route)
      if (!isProviderMembershipRequest(body) || !body.role) {
        await jsonResponse(route, 400, { success: false, error: 'Invalid provider membership request' })
        return
      }

      preapproveRequests.push(body)
      const existing = preapprovals.find((preapproval) => (
        preapproval.providerSubject === body.providerSubject
        && preapproval.providerTenant === body.providerTenant
        && preapproval.workspaceSlug === body.workspaceSlug
      ))
      const preapproval: ProviderPreapproval = {
        provider: body.provider,
        providerSubject: body.providerSubject,
        providerTenant: body.providerTenant,
        workspaceSlug: body.workspaceSlug,
        role: body.role,
        operatorId: users.admin.id,
        active: true,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      if (existing) {
        Object.assign(existing, preapproval)
      } else {
        preapprovals.push(preapproval)
      }

      const identity = identities.find((item) => (
        item.providerSubject === body.providerSubject
        && item.providerTenant === body.providerTenant
      ))
      const appliedMemberships: WorkspaceMembership[] = identity
        ? [{ userId: identity.userId, workspaceSlug: body.workspaceSlug, role: body.role }]
        : []
      if (identity) {
        const existingGrant = grants.find((grant) => (
          grant.providerSubject === body.providerSubject
          && grant.providerTenant === body.providerTenant
          && grant.workspaceSlug === body.workspaceSlug
          && grant.userId === identity.userId
        ))
        const grant: ProviderGrant = {
          provider: body.provider,
          providerSubject: body.providerSubject,
          providerTenant: body.providerTenant,
          workspaceSlug: body.workspaceSlug,
          role: body.role,
          userId: identity.userId,
          preapprovalId: `preapproval-${body.providerSubject}`,
          active: true,
          grantedAt: now,
        }
        if (existingGrant) {
          Object.assign(existingGrant, grant)
        } else {
          grants.push(grant)
        }
        events.unshift({
          id: `event-granted-${body.providerSubject}`,
          type: 'workspace_membership_granted',
          provider: body.provider,
          userId: identity.userId,
          workspaceSlug: body.workspaceSlug,
          createdAt: now,
        })
      }

      await jsonResponse(route, 200, {
        success: true,
        preapproval,
        appliedMemberships,
      })
      return
    }

    if (pathname === '/api/auth/provider-memberships/revoke' && method === 'POST') {
      if (!hasWorkspaceAdminAccess(currentUser, workspaceSlug)) {
        deniedProviderRequests.push({ method, path: pathname })
        await jsonResponse(route, currentUser ? 403 : 401, {
          success: false,
          error: currentUser ? 'Admin access required' : 'Authentication required',
        })
        return
      }

      const body = parseJsonBody(route)
      if (!isProviderMembershipRequest(body)) {
        await jsonResponse(route, 400, { success: false, error: 'Invalid provider membership request' })
        return
      }

      revokeRequests.push(body)
      const preapproval = preapprovals.find((item) => (
        item.providerSubject === body.providerSubject
        && item.providerTenant === body.providerTenant
        && item.workspaceSlug === body.workspaceSlug
      ))
      if (!preapproval) {
        await jsonResponse(route, 404, { success: false, error: 'Provider membership preapproval not found' })
        return
      }

      preapproval.active = false
      preapproval.revokedAt = now
      preapproval.revokedBy = users.admin.id
      for (const grant of grants) {
        if (
          grant.providerSubject === body.providerSubject
          && grant.providerTenant === body.providerTenant
          && grant.workspaceSlug === body.workspaceSlug
        ) {
          grant.active = false
          grant.revokedAt = now
          events.unshift({
            id: `event-revoked-${body.providerSubject}`,
            type: 'workspace_membership_revoked',
            provider: body.provider,
            userId: grant.userId,
            workspaceSlug: body.workspaceSlug,
            createdAt: now,
          })
        }
      }

      await jsonResponse(route, 200, {
        success: true,
        revoked: preapproval,
      })
      return
    }

    if (pathname === '/api/query') {
      await jsonResponse(route, 200, { status: 'success', value: null })
      return
    }

    if (pathname === '/api/mutation') {
      await jsonResponse(route, 200, { status: 'success', value: null })
      return
    }

    await jsonResponse(route, 200, { success: true })
  })

  return {
    preapproveRequests,
    revokeRequests,
    deniedProviderRequests,
  }
}

async function signIn(page: Page, username: string, password: string, redirectTo: string) {
  // Canonical login lives at /login since 43240996 (workspace-scoped
  // /dev/login existed only as a legacy bounce target).
  await page.goto(`/login?redirectTo=${encodeURIComponent(redirectTo)}`)
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(new RegExp(`${redirectTo.replace(/\//g, '\\/')}$`))
}

test.describe('Provider membership admin page', () => {
  test('admin can operate provider membership grants and revocations', async ({ page }) => {
    const api = await installProviderMembershipApi(page)

    await signIn(page, 'admin-e2e', 'admin-secret', '/admin/system/settings/auth')
    const consoleProblems = collectConsoleProblems(page)
    await page.reload()

    await expect(page.getByRole('heading', { name: 'Auth access' })).toBeVisible()
    await expect(page.getByText('WeCom E2E Candidate').first()).toBeVisible()
    await expect(page.getByText('wecom-seeded-42').first()).toBeVisible()
    await expect(page.getByText('wecom-corp-e2e').first()).toBeVisible()
    await expect(page.getByText('Provider-derived grants')).toBeVisible()
    await expect(page.getByText('workspace_membership_granted').first()).toBeVisible()

    await page.getByTestId('auth-provider-subject-input').fill('wecom-grant-99')
    await page.getByTestId('auth-provider-tenant-input').fill('wecom-corp-e2e')
    await page.getByTestId('auth-workspace-input').fill('dev')
    await page.getByTestId('auth-role-select').selectOption('admin')
    await page.getByTestId('auth-preapprove-submit').click()

    await expect(page.getByText('Provider access saved')).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'wecom-grant-99' }).filter({ hasText: 'admin' }).first()).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'wecom-grant-99' }).getByTestId('auth-revoke-wecom-grant-99-dev').first()).toBeVisible()
    expect(api.preapproveRequests).toEqual([
      {
        provider: 'casdoor',
        providerSubject: 'wecom-grant-99',
        providerTenant: 'wecom-corp-e2e',
        workspaceSlug: 'dev',
        role: 'admin',
      },
    ])

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Revoke this provider-derived workspace access?')
      await dialog.accept()
    })
    await page.getByRole('row').filter({ hasText: 'wecom-grant-99' }).getByTestId('auth-revoke-wecom-grant-99-dev').first().click()

    await expect(page.getByText('Provider access revoked')).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'wecom-grant-99' }).filter({ hasText: 'Revoked' }).first()).toBeVisible()
    await expect(page.getByText('workspace_membership_revoked').first()).toBeVisible()
    await expect(page.getByTestId('auth-revoke-wecom-grant-99-dev')).toHaveCount(0)
    expect(api.revokeRequests).toEqual([
      {
        provider: 'casdoor',
        providerSubject: 'wecom-grant-99',
        providerTenant: 'wecom-corp-e2e',
        workspaceSlug: 'dev',
      },
    ])

    const pageText = await page.locator('body').innerText()
    // The current auth page intentionally describes a "passwordless" desk
    // token, so match standalone secret-field names/values rather than the
    // substring "password" inside that copy.
    expect(pageText).not.toMatch(/rawProfile|raw_profile|access_token|id_token|\bsecret\b|\bpassword\b|admin-secret|hr-secret/i)
    expect(consoleProblems.messages).toEqual([])
  })

  test('HR user cannot operate provider membership admin page or endpoints', async ({ page }) => {
    const api = await installProviderMembershipApi(page)

    // System admin routes are dev-workspace-only: an HR user requesting
    // settings/auth is denied via the workspace-scoped system route
    // (WorkspaceSystemDeniedPage), never reaching /admin/system/settings/auth.
    await signIn(page, 'hr-e2e', 'hr-secret', '/hr/system/settings/auth')

    await expect(page.getByText('Admin access required')).toBeVisible()
    await expect(page.getByTestId('auth-preapprove-submit')).toHaveCount(0)

    const status = await page.evaluate(async () => {
      const response = await fetch('/api/auth/provider-memberships/preapprove', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-Slug': 'admin',
        },
        body: JSON.stringify({
          provider: 'casdoor',
          providerSubject: 'blocked-subject',
          providerTenant: 'wecom-corp-e2e',
          workspaceSlug: 'dev',
          role: 'user',
        }),
      })
      return response.status
    })

    expect(status).toBe(403)
    // The auth page never mounts for HR, so no GET denial is recorded —
    // only the direct endpoint probe.
    expect(api.deniedProviderRequests).toEqual([
      { method: 'POST', path: '/api/auth/provider-memberships/preapprove' },
    ])
  })
})
