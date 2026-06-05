import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockApiClient = vi.hoisted(() => ({
  GET: vi.fn(),
  POST: vi.fn(),
}))

vi.mock('./api-helpers', () => ({
  rawApiClient: mockApiClient,
}))

vi.mock('./api-client', () => ({
  apiBaseUrl: '',
}))

import {
  fetchCurrentAuth,
  getCasdoorLoginUrl,
  loginWithLocalPassword,
  logout,
} from './auth'

const user = {
  id: 'user-1',
  email: 'admin@example.com',
  displayName: 'Admin',
  status: 'active' as const,
}

const authMe = {
  success: true as const,
  user,
  memberships: [{ userId: 'user-1', workspaceSlug: 'dev', role: 'admin' as const }],
  workspaceRole: 'admin' as const,
}

describe('auth helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches the current auth context', async () => {
    mockApiClient.GET.mockResolvedValueOnce({ data: authMe })

    await expect(fetchCurrentAuth()).resolves.toEqual(authMe)

    expect(mockApiClient.GET).toHaveBeenCalledWith('/api/auth/me')
  })

  it('returns null when current auth request is unauthenticated', async () => {
    mockApiClient.GET.mockResolvedValueOnce({ error: { status: 401 } })

    await expect(fetchCurrentAuth()).resolves.toBeNull()
  })

  it('logs in with local credentials', async () => {
    const loginResponse = {
      success: true as const,
      user,
      memberships: authMe.memberships,
      csrfToken: 'csrf-token',
      expiresAt: '2026-06-06T00:00:00.000Z',
    }
    mockApiClient.POST.mockResolvedValueOnce({ data: loginResponse })

    await expect(loginWithLocalPassword('admin', 'secret')).resolves.toEqual(loginResponse)

    expect(mockApiClient.POST).toHaveBeenCalledWith('/api/auth/login', {
      body: { username: 'admin', password: 'secret' },
    })
  })

  it('logs out through the auth endpoint', async () => {
    mockApiClient.POST.mockResolvedValueOnce({ data: { success: true } })

    await expect(logout()).resolves.toBe(true)

    expect(mockApiClient.POST).toHaveBeenCalledWith('/api/auth/logout')
  })

  it('builds a Casdoor login URL with a safe redirect path', () => {
    expect(getCasdoorLoginUrl('/settings?tab=auth')).toBe(
      '/api/auth/casdoor/login?redirectTo=%2Fsettings%3Ftab%3Dauth',
    )
  })
})
