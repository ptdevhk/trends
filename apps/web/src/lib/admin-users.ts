import { type WorkspaceSlug } from '@trends/shared'
import { type WorkspaceRole, type AuthEvent } from './auth'
import { rawApiClient } from './api-helpers'

export type AdminUserRecord = {
  id: string
  email?: string
  displayName?: string
  status: 'active' | 'disabled'
  createdAt: string
  identities: {
    provider: 'local' | 'casdoor'
    providerSubject: string
    providerTenant: string | null
  }[]
  memberships: {
    workspaceSlug: string
    role: 'user' | 'admin'
  }[]
}

export type AdminUsersError = { success: false; error: string; status?: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readStatus(value: unknown): number | undefined {
  if (!isRecord(value) || typeof value.status !== 'number') {
    return undefined
  }
  return value.status
}

function readErrorMessage(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (value instanceof Error && value.message.trim()) {
    return value.message
  }
  if (!isRecord(value)) {
    return undefined
  }
  if (typeof value.error === 'string' && value.error.trim()) {
    return value.error
  }
  if (typeof value.message === 'string' && value.message.trim()) {
    return value.message
  }
  return undefined
}

function defaultErrorForStatus(status: number | undefined, fallback: string): string {
  switch (status) {
    case 401:
      return 'Authentication required'
    case 403:
      return 'Admin access required'
    default:
      return fallback
  }
}

function toAdminUsersError(
  data: unknown,
  error: unknown,
  response: { status?: number } | undefined,
  fallback: string,
): AdminUsersError {
  const status = response?.status ?? readStatus(error) ?? readStatus(data)
  const message = readErrorMessage(data) ?? readErrorMessage(error) ?? defaultErrorForStatus(status, fallback)
  const result: AdminUsersError = { success: false, error: message }
  if (status !== undefined) {
    result.status = status
  }
  return result
}

export async function listAdminUsers(): Promise<
  { success: true; users: AdminUserRecord[] } | AdminUsersError
> {
  const { data, error, response } = await rawApiClient.GET<{ success: true; users: AdminUserRecord[] }>(
    '/api/admin/users',
  )
  if (data?.success === true) {
    return data
  }
  return toAdminUsersError(data, error, response, 'Failed to list admin users')
}

export async function createAdminUser(input: {
  username: string
  email?: string
  displayName?: string
  /** Optional system team seats (hr/dev). Personal desk is always created server-side. */
  systemMemberships?: Array<{ workspaceSlug: WorkspaceSlug; role: WorkspaceRole }>
  /** @deprecated Prefer systemMemberships */
  initialMembership?: { workspaceSlug: WorkspaceSlug; role: WorkspaceRole }
}): Promise<{ success: true; user: AdminUserRecord; temporaryPassword: string } | AdminUsersError> {
  const { data, error, response } = await rawApiClient.POST<{
    success: true
    user: AdminUserRecord
    temporaryPassword: string
  }>('/api/admin/users', { body: input })
  if (data?.success === true) {
    return data
  }
  return toAdminUsersError(data, error, response, 'Failed to create admin user')
}

export async function disableAdminUser(
  id: string,
): Promise<{ success: true; sessionsRevoked: number } | AdminUsersError> {
  const { data, error, response } = await rawApiClient.POST<{ success: true; sessionsRevoked: number }>(
    `/api/admin/users/${id}/disable`,
  )
  if (data?.success === true) {
    return data
  }
  return toAdminUsersError(data, error, response, 'Failed to disable admin user')
}

export async function enableAdminUser(id: string): Promise<{ success: true } | AdminUsersError> {
  const { data, error, response } = await rawApiClient.POST<{ success: true }>(
    `/api/admin/users/${id}/enable`,
  )
  if (data?.success === true) {
    return data
  }
  return toAdminUsersError(data, error, response, 'Failed to enable admin user')
}

export async function addAdminUserMembership(
  id: string,
  input: { workspaceSlug: WorkspaceSlug; role: WorkspaceRole },
): Promise<{ success: true; created: boolean } | AdminUsersError> {
  const { data, error, response } = await rawApiClient.POST<{ success: true; created: boolean }>(
    `/api/admin/users/${id}/memberships`,
    { body: input },
  )
  if (data?.success === true) {
    return data
  }
  return toAdminUsersError(data, error, response, 'Failed to add membership')
}

export async function removeAdminUserMembership(
  id: string,
  workspaceSlug: WorkspaceSlug,
): Promise<{ success: true; deleted: boolean } | AdminUsersError> {
  const { data, error, response } = await rawApiClient.DELETE<{ success: true; deleted: boolean }>(
    `/api/admin/users/${id}/memberships/${workspaceSlug}`,
  )
  if (data?.success === true) {
    return data
  }
  return toAdminUsersError(data, error, response, 'Failed to remove membership')
}

export async function listAdminUserAuthEvents(
  id: string,
  opts?: { limit?: number },
): Promise<{ success: true; events: AuthEvent[] } | AdminUsersError> {
  const { data, error, response } = await rawApiClient.GET<{ success: true; events: AuthEvent[] }>(
    `/api/admin/users/${id}/auth-events`,
    { params: { query: opts?.limit !== undefined ? { limit: opts.limit } : undefined } },
  )
  if (data?.success === true) {
    return data
  }
  return toAdminUsersError(data, error, response, 'Failed to list auth events')
}

export async function resetAdminUserPassword(
  username: string,
): Promise<{ success: true; temporaryPassword: string } | AdminUsersError> {
  const { data, error, response } = await rawApiClient.POST<{
    success: true
    temporaryPassword: string
  }>('/api/admin/reset-password', { body: { username } })
  if (data?.success === true) {
    return data
  }
  return toAdminUsersError(data, error, response, 'Failed to reset password')
}

export async function unlockAdminUser(
  username: string,
): Promise<{ success: true; cleared: boolean; removedCount: number } | AdminUsersError> {
  const { data, error, response } = await rawApiClient.POST<{
    success: true
    cleared: boolean
    removedCount: number
  }>('/api/admin/auth/unlock', { body: { username } })
  if (data?.success === true) {
    return data
  }
  return toAdminUsersError(data, error, response, 'Failed to unlock user')
}
