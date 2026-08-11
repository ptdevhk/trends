import { beforeEach, describe, expect, it } from 'vitest'
import type { CurrentAuth } from '@/lib/auth'
import {
  canUseExplicitRedirect,
  getDefaultAuthenticatedPath,
  hasWorkspaceIndustryReviewAccess,
  hasWorkspaceMembership,
  SYSTEM_ROUTE_PREFIX,
} from '@/lib/workspace-access'

function authFor(
  memberships: Array<{ workspaceSlug: string; role: 'user' | 'reviewer' | 'admin' }>,
  userId = 'u1',
): Extract<CurrentAuth, { success: true }> {
  return {
    success: true,
    user: { id: userId, status: 'active' },
    memberships: memberships.map((m) => ({ userId, ...m })),
    workspaceRole: memberships[0]?.role ?? null,
  }
}

describe('getDefaultAuthenticatedPath', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('sends hr members to /hr/resumes', () => {
    expect(getDefaultAuthenticatedPath(authFor([{ workspaceSlug: 'hr', role: 'user' }]), 'dev')).toBe(
      '/hr/resumes',
    )
  })

  it('sends dev admins to /dev/resumes (not system settings)', () => {
    expect(getDefaultAuthenticatedPath(authFor([{ workspaceSlug: 'dev', role: 'admin' }]), 'hr')).toBe(
      '/dev/resumes',
    )
  })

  it('prefers last workspace when still a membership', () => {
    window.localStorage.setItem('trends.lastWorkspace.u1', 'hr')
    const auth = authFor([
      { workspaceSlug: 'dev', role: 'admin' },
      { workspaceSlug: 'hr', role: 'user' },
    ])
    expect(getDefaultAuthenticatedPath(auth, 'dev')).toBe('/hr/resumes')
  })
})

describe('canUseExplicitRedirect', () => {
  it('allows system redirect only for dev admins', () => {
    const admin = authFor([{ workspaceSlug: 'dev', role: 'admin' }])
    const hr = authFor([{ workspaceSlug: 'hr', role: 'user' }])
    expect(canUseExplicitRedirect(admin, `${SYSTEM_ROUTE_PREFIX}/settings/auth`)).toBe(true)
    expect(canUseExplicitRedirect(hr, `${SYSTEM_ROUTE_PREFIX}/settings/auth`)).toBe(false)
  })

  it('allows workspace redirect only for members of that slug', () => {
    const hr = authFor([{ workspaceSlug: 'hr', role: 'user' }])
    expect(canUseExplicitRedirect(hr, '/hr/resumes?location=Malaysia')).toBe(true)
    expect(canUseExplicitRedirect(hr, '/dev/resumes?location=Malaysia')).toBe(false)
  })
})

describe('hasWorkspaceMembership', () => {
  it('admits reviewer memberships with default roles (reviewer inherits member access)', () => {
    const reviewer = authFor([{ workspaceSlug: 'hr', role: 'reviewer' }])
    expect(hasWorkspaceMembership(reviewer.memberships, 'hr')).toBe(true)
  })
})

describe('hasWorkspaceIndustryReviewAccess', () => {
  it('admits a reviewer membership of the workspace', () => {
    const reviewer = authFor([{ workspaceSlug: 'hr', role: 'reviewer' }])
    expect(hasWorkspaceIndustryReviewAccess(reviewer.memberships, 'hr')).toBe(true)
  })

  it('admits an admin membership of the workspace', () => {
    const admin = authFor([{ workspaceSlug: 'hr', role: 'admin' }])
    expect(hasWorkspaceIndustryReviewAccess(admin.memberships, 'hr')).toBe(true)
  })

  it('rejects a plain user membership', () => {
    const user = authFor([{ workspaceSlug: 'hr', role: 'user' }])
    expect(hasWorkspaceIndustryReviewAccess(user.memberships, 'hr')).toBe(false)
  })

  it('rejects empty memberships and memberships of other workspaces', () => {
    expect(hasWorkspaceIndustryReviewAccess([], 'hr')).toBe(false)
    const devAdmin = authFor([{ workspaceSlug: 'dev', role: 'admin' }])
    expect(hasWorkspaceIndustryReviewAccess(devAdmin.memberships, 'hr')).toBe(false)
  })
})
