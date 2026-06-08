import { rawApiClient } from './api-helpers'
import { apiBaseUrl } from './api-client'

export type AuthUser = {
  id: string
  email?: string
  displayName?: string
  status: 'active' | 'disabled'
}

export type WorkspaceRole = 'user' | 'admin'
export type AuthProvider = 'local' | 'casdoor'

export type WorkspaceMembership = {
  userId: string
  workspaceSlug: string
  role: WorkspaceRole
}

export type CurrentAuth = {
  success: true
  user: AuthUser
  memberships: WorkspaceMembership[]
  workspaceRole: WorkspaceRole | null
}

export type LocalLoginResponse = {
  success: true
  user: AuthUser
  memberships: WorkspaceMembership[]
  csrfToken: string
  expiresAt: string
}

export type ProviderIdentity = {
  provider: AuthProvider
  providerSubject: string
  providerTenant: string | null
  userId: string
  email?: string
  displayName?: string
  updatedAt: string
}

export type ProviderMembershipPreapproval = {
  provider: AuthProvider
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

export type ProviderMembershipGrant = {
  provider: AuthProvider
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

export type AuthEvent = {
  id: string
  type: string
  userId?: string
  provider?: string
  workspaceSlug?: string
  sessionId?: string
  reason?: string
  metadata?: Record<string, unknown>
  ipHash?: string
  userAgent?: string
  createdAt: string
}

export type ProviderMembershipsResponse = {
  success: true
  identities: ProviderIdentity[]
  preapprovals: ProviderMembershipPreapproval[]
  grants: ProviderMembershipGrant[]
  events: AuthEvent[]
}

export type PreapproveProviderMembershipInput = {
  provider: AuthProvider
  providerSubject: string
  providerTenant: string
  workspaceSlug: string
  role: WorkspaceRole
}

export type PreapproveProviderMembershipResponse = {
  success: true
  preapproval: ProviderMembershipPreapproval
  appliedMemberships: WorkspaceMembership[]
}

export type RevokeProviderMembershipInput = {
  provider: AuthProvider
  providerSubject: string
  providerTenant: string
  workspaceSlug: string
}

export type RevokeProviderMembershipResponse = {
  success: true
  revoked: ProviderMembershipPreapproval
}

function joinApiPath(path: string): string {
  return `${apiBaseUrl.replace(/\/$/, '')}${path}`
}

function getCurrentRedirectPath(): string {
  if (typeof window === 'undefined') {
    return '/'
  }
  return `${window.location.pathname}${window.location.search}${window.location.hash}` || '/'
}

function sanitizeRedirectPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) {
    return '/'
  }
  return path
}

export async function fetchCurrentAuth(): Promise<CurrentAuth | null> {
  const { data, error } = await rawApiClient.GET<CurrentAuth>('/api/auth/me')
  if (error || data?.success !== true) {
    return null
  }
  return data
}

export async function loginWithLocalPassword(username: string, password: string): Promise<LocalLoginResponse | null> {
  const { data, error } = await rawApiClient.POST<LocalLoginResponse>('/api/auth/login', {
    body: { username, password },
  })
  if (error || data?.success !== true) {
    return null
  }
  return data
}

export async function logout(): Promise<boolean> {
  const { data, error } = await rawApiClient.POST<{ success: boolean }>('/api/auth/logout')
  return !error && data?.success === true
}

export async function fetchProviderMemberships(): Promise<ProviderMembershipsResponse | null> {
  const { data, error } = await rawApiClient.GET<ProviderMembershipsResponse>('/api/auth/provider-memberships')
  if (error || data?.success !== true) {
    return null
  }
  return data
}

export async function preapproveProviderMembership(
  input: PreapproveProviderMembershipInput,
): Promise<PreapproveProviderMembershipResponse | null> {
  const { data, error } = await rawApiClient.POST<PreapproveProviderMembershipResponse>(
    '/api/auth/provider-memberships/preapprove',
    { body: input },
  )
  if (error || data?.success !== true) {
    return null
  }
  return data
}

export async function revokeProviderMembership(
  input: RevokeProviderMembershipInput,
): Promise<RevokeProviderMembershipResponse | null> {
  const { data, error } = await rawApiClient.POST<RevokeProviderMembershipResponse>(
    '/api/auth/provider-memberships/revoke',
    { body: input },
  )
  if (error || data?.success !== true) {
    return null
  }
  return data
}

export function getCasdoorLoginUrl(redirectTo: string = getCurrentRedirectPath()): string {
  const params = new URLSearchParams({ redirectTo: sanitizeRedirectPath(redirectTo) })
  return `${joinApiPath('/api/auth/casdoor/login')}?${params.toString()}`
}

export function redirectToCasdoorLogin(redirectTo?: string): void {
  window.location.assign(getCasdoorLoginUrl(redirectTo))
}
