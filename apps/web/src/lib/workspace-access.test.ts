import { beforeEach, describe, expect, it } from 'vitest'
import type { CurrentAuth } from '@/lib/auth'
import {
  canUseExplicitRedirect,
  getDefaultAuthenticatedPath,
  SYSTEM_ROUTE_PREFIX,
} from '@/lib/workspace-access'

function authFor(
  memberships: Array<{ workspaceSlug: string; role: 'user' | 'admin' }>,
  userId = 'u1',
): CurrentAuth {
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
