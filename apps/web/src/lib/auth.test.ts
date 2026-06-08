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
  fetchProviderMemberships,
  getCasdoorLoginUrl,
  loginWithLocalPassword,
  logout,
  preapproveProviderMembership,
  revokeProviderMembership,
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

  it('fetches provider membership admin state', async () => {
    const providerMemberships = {
      success: true as const,
      identities: [
        {
          provider: 'casdoor' as const,
          providerSubject: 'sub-1',
          providerTenant: 'tenant-1',
          userId: 'user-1',
          email: 'casdoor@example.com',
          displayName: 'Casdoor User',
          updatedAt: '2026-06-08T00:00:00.000Z',
        },
      ],
      preapprovals: [],
      grants: [],
      events: [],
    }
    mockApiClient.GET.mockResolvedValueOnce({ data: providerMemberships })

    await expect(fetchProviderMemberships()).resolves.toEqual(providerMemberships)

    expect(mockApiClient.GET).toHaveBeenCalledWith('/api/auth/provider-memberships')
  })

  it('returns provider membership fetch failures with status and message', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      error: { success: false, error: 'Admin access required' },
      response: { status: 403 },
    })

    await expect(fetchProviderMemberships()).resolves.toEqual({
      success: false,
      status: 403,
      error: 'Admin access required',
    })
  })

  it('preapproves provider membership through the auth endpoint', async () => {
    const response = {
      success: true as const,
      preapproval: {
        provider: 'casdoor' as const,
        providerSubject: 'sub-1',
        providerTenant: 'tenant-1',
        workspaceSlug: 'hr',
        role: 'user' as const,
        operatorId: 'admin-1',
        active: true,
        createdAt: '2026-06-08T00:00:00.000Z',
        updatedAt: '2026-06-08T00:00:00.000Z',
      },
      appliedMemberships: [],
    }
    mockApiClient.POST.mockResolvedValueOnce({ data: response })

    await expect(preapproveProviderMembership({
      provider: 'casdoor',
      providerSubject: 'sub-1',
      providerTenant: 'tenant-1',
      workspaceSlug: 'hr',
      role: 'user',
    })).resolves.toEqual(response)

    expect(mockApiClient.POST).toHaveBeenCalledWith('/api/auth/provider-memberships/preapprove', {
      body: {
        provider: 'casdoor',
        providerSubject: 'sub-1',
        providerTenant: 'tenant-1',
        workspaceSlug: 'hr',
        role: 'user',
      },
    })
  })

  it('returns provider preapproval failures with status and message', async () => {
    mockApiClient.POST.mockResolvedValueOnce({
      error: { success: false, error: 'Invalid workspace' },
      response: { status: 400 },
    })

    await expect(preapproveProviderMembership({
      provider: 'casdoor',
      providerSubject: 'sub-1',
      providerTenant: 'tenant-1',
      workspaceSlug: 'prod',
      role: 'user',
    })).resolves.toEqual({
      success: false,
      status: 400,
      error: 'Invalid workspace',
    })
  })

  it('revokes provider membership through the auth endpoint', async () => {
    const response = {
      success: true as const,
      revoked: {
        provider: 'casdoor' as const,
        providerSubject: 'sub-1',
        providerTenant: 'tenant-1',
        workspaceSlug: 'hr',
        role: 'user' as const,
        operatorId: 'admin-1',
        active: false,
        createdAt: '2026-06-08T00:00:00.000Z',
        updatedAt: '2026-06-08T00:00:00.000Z',
        revokedAt: '2026-06-08T00:00:01.000Z',
      },
    }
    mockApiClient.POST.mockResolvedValueOnce({ data: response })

    await expect(revokeProviderMembership({
      provider: 'casdoor',
      providerSubject: 'sub-1',
      providerTenant: 'tenant-1',
      workspaceSlug: 'hr',
    })).resolves.toEqual(response)

    expect(mockApiClient.POST).toHaveBeenCalledWith('/api/auth/provider-memberships/revoke', {
      body: {
        provider: 'casdoor',
        providerSubject: 'sub-1',
        providerTenant: 'tenant-1',
        workspaceSlug: 'hr',
      },
    })
  })

  it('returns provider revocation failures with status and message', async () => {
    mockApiClient.POST.mockResolvedValueOnce({
      error: { success: false, error: 'Provider membership preapproval not found' },
      response: { status: 404 },
    })

    await expect(revokeProviderMembership({
      provider: 'casdoor',
      providerSubject: 'sub-1',
      providerTenant: 'tenant-1',
      workspaceSlug: 'hr',
    })).resolves.toEqual({
      success: false,
      status: 404,
      error: 'Provider membership preapproval not found',
    })
  })
})
