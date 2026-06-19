import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockApiClient = vi.hoisted(() => ({
  GET: vi.fn(),
  POST: vi.fn(),
  DELETE: vi.fn(),
}))

vi.mock('./api-helpers', () => ({
  rawApiClient: mockApiClient,
}))

vi.mock('./api-client', () => ({
  apiBaseUrl: '',
}))

import {
  listAdminUsers,
  createAdminUser,
  disableAdminUser,
  enableAdminUser,
  addAdminUserMembership,
  removeAdminUserMembership,
  listAdminUserAuthEvents,
  resetAdminUserPassword,
  unlockAdminUser,
} from './admin-users'

const adminUser = {
  id: 'user-1',
  email: 'alice@example.com',
  displayName: 'Alice',
  status: 'active' as const,
  createdAt: '2026-06-19T00:00:00.000Z',
  identities: [
    {
      provider: 'local' as const,
      providerSubject: 'alice',
      providerTenant: null,
    },
  ],
  memberships: [{ workspaceSlug: 'hr', role: 'admin' as const }],
}

describe('admin-users client wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('listAdminUsers', () => {
    it('returns the users list on success', async () => {
      mockApiClient.GET.mockResolvedValueOnce({
        data: { success: true as const, users: [adminUser] },
      })

      const result = await listAdminUsers()

      expect(result).toEqual({ success: true, users: [adminUser] })
      expect(mockApiClient.GET).toHaveBeenCalledWith('/api/admin/users')
    })

    it('returns an error object on 401', async () => {
      mockApiClient.GET.mockResolvedValueOnce({
        data: { success: false as const, error: 'Authentication required' },
        response: { status: 401 },
      })

      const result = await listAdminUsers()

      expect(result).toEqual({
        success: false,
        error: 'Authentication required',
        status: 401,
      })
    })

    it('returns an error object on 403', async () => {
      mockApiClient.GET.mockResolvedValueOnce({
        data: { success: false as const, error: 'Admin access required' },
        response: { status: 403 },
      })

      const result = await listAdminUsers()

      expect(result).toEqual({
        success: false,
        error: 'Admin access required',
        status: 403,
      })
    })
  })

  describe('createAdminUser', () => {
    it('returns the created user on success', async () => {
      const createResponse = {
        success: true as const,
        user: adminUser,
        temporaryPassword: 'tmp-pass-123',
      }
      mockApiClient.POST.mockResolvedValueOnce({ data: createResponse })

      const result = await createAdminUser({
        username: 'alice',
        email: 'alice@example.com',
        displayName: 'Alice',
      })

      expect(result).toEqual(createResponse)
      expect(mockApiClient.POST).toHaveBeenCalledWith('/api/admin/users', {
        body: {
          username: 'alice',
          email: 'alice@example.com',
          displayName: 'Alice',
        },
      })
    })

    it('returns an error object on 409 username taken', async () => {
      mockApiClient.POST.mockResolvedValueOnce({
        data: { success: false as const, error: 'Username already exists' },
        response: { status: 409 },
      })

      const result = await createAdminUser({ username: 'alice' })

      expect(result).toEqual({
        success: false,
        error: 'Username already exists',
        status: 409,
      })
    })
  })

  describe('disableAdminUser', () => {
    it('returns sessions revoked count on success', async () => {
      mockApiClient.POST.mockResolvedValueOnce({
        data: { success: true as const, sessionsRevoked: 3 },
      })

      const result = await disableAdminUser('user-1')

      expect(result).toEqual({ success: true, sessionsRevoked: 3 })
      expect(mockApiClient.POST).toHaveBeenCalledWith('/api/admin/users/user-1/disable')
    })

    it('returns an error object on 400 self-disable', async () => {
      mockApiClient.POST.mockResolvedValueOnce({
        data: { success: false as const, error: 'Cannot disable yourself' },
        response: { status: 400 },
      })

      const result = await disableAdminUser('user-1')

      expect(result).toEqual({
        success: false,
        error: 'Cannot disable yourself',
        status: 400,
      })
    })
  })

  describe('addAdminUserMembership', () => {
    it('returns created flag on success', async () => {
      mockApiClient.POST.mockResolvedValueOnce({
        data: { success: true as const, created: true },
      })

      const result = await addAdminUserMembership('user-1', {
        workspaceSlug: 'hr',
        role: 'admin',
      })

      expect(result).toEqual({ success: true, created: true })
      expect(mockApiClient.POST).toHaveBeenCalledWith('/api/admin/users/user-1/memberships', {
        body: { workspaceSlug: 'hr', role: 'admin' },
      })
    })

    it('returns an error object on 404', async () => {
      mockApiClient.POST.mockResolvedValueOnce({
        data: { success: false as const, error: 'User not found' },
        response: { status: 404 },
      })

      const result = await addAdminUserMembership('user-1', {
        workspaceSlug: 'hr',
        role: 'user',
      })

      expect(result).toEqual({
        success: false,
        error: 'User not found',
        status: 404,
      })
    })
  })

  describe('removeAdminUserMembership', () => {
    it('returns deleted flag on success', async () => {
      mockApiClient.DELETE.mockResolvedValueOnce({
        data: { success: true as const, deleted: true },
      })

      const result = await removeAdminUserMembership('user-1', 'hr')

      expect(result).toEqual({ success: true, deleted: true })
      expect(mockApiClient.DELETE).toHaveBeenCalledWith('/api/admin/users/user-1/memberships/hr')
    })

    it('returns an error object on 400 self-demotion', async () => {
      mockApiClient.DELETE.mockResolvedValueOnce({
        data: { success: false as const, error: 'Cannot remove your own last admin membership' },
        response: { status: 400 },
      })

      const result = await removeAdminUserMembership('user-1', 'hr')

      expect(result).toEqual({
        success: false,
        error: 'Cannot remove your own last admin membership',
        status: 400,
      })
    })
  })

  describe('listAdminUserAuthEvents', () => {
    it('returns events on success', async () => {
      const events = [
        {
          id: 'evt-1',
          type: 'login_success',
          userId: 'user-1',
          createdAt: '2026-06-19T00:00:00.000Z',
        },
      ]
      mockApiClient.GET.mockResolvedValueOnce({
        data: { success: true as const, events },
      })

      const result = await listAdminUserAuthEvents('user-1')

      expect(result).toEqual({ success: true, events })
      expect(mockApiClient.GET).toHaveBeenCalledWith(
        '/api/admin/users/user-1/auth-events',
        { params: { query: undefined } },
      )
    })

    it('passes limit query param when provided', async () => {
      mockApiClient.GET.mockResolvedValueOnce({
        data: { success: true as const, events: [] },
      })

      await listAdminUserAuthEvents('user-1', { limit: 5 })

      expect(mockApiClient.GET).toHaveBeenCalledWith(
        '/api/admin/users/user-1/auth-events',
        { params: { query: { limit: 5 } } },
      )
    })
  })

  describe('resetAdminUserPassword', () => {
    it('returns temporary password on success', async () => {
      mockApiClient.POST.mockResolvedValueOnce({
        data: { success: true as const, temporaryPassword: 'new-pass-456' },
      })

      const result = await resetAdminUserPassword('alice')

      expect(result).toEqual({ success: true, temporaryPassword: 'new-pass-456' })
      expect(mockApiClient.POST).toHaveBeenCalledWith('/api/admin/reset-password', {
        body: { username: 'alice' },
      })
    })
  })

  describe('unlockAdminUser', () => {
    it('returns cleared and removedCount on success', async () => {
      mockApiClient.POST.mockResolvedValueOnce({
        data: { success: true as const, cleared: true, removedCount: 2 },
      })

      const result = await unlockAdminUser('alice')

      expect(result).toEqual({ success: true, cleared: true, removedCount: 2 })
      expect(mockApiClient.POST).toHaveBeenCalledWith('/api/admin/auth/unlock', {
        body: { username: 'alice' },
      })
    })
  })

  describe('enableAdminUser', () => {
    it('returns success on enable', async () => {
      mockApiClient.POST.mockResolvedValueOnce({
        data: { success: true as const },
      })

      const result = await enableAdminUser('user-1')

      expect(result).toEqual({ success: true })
      expect(mockApiClient.POST).toHaveBeenCalledWith('/api/admin/users/user-1/enable')
    })
  })
})
