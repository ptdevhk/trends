import { rawApiClient } from './api-helpers'
import { apiBaseUrl } from './api-client'

export type AuthUser = {
  id: string
  email?: string
  displayName?: string
  status: 'active' | 'disabled'
}

export type WorkspaceRole = 'user' | 'reviewer' | 'admin'
export type AuthProvider = 'local' | 'casdoor'

export type WorkspaceMembership = {
  userId: string
  workspaceSlug: string
  role: WorkspaceRole
}

export type CurrentAuth =
  | {
      success: true
      user: AuthUser
      memberships: WorkspaceMembership[]
      workspaceRole: WorkspaceRole | null
    }
  | {
      success: false
      error: string
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

export type ProviderMembershipApiError = {
  success: false
  error: string
  status?: number
}

export type ProviderMembershipsResult = ProviderMembershipsResponse | ProviderMembershipApiError

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

export type PreapproveProviderMembershipResult = PreapproveProviderMembershipResponse | ProviderMembershipApiError

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

export type RevokeProviderMembershipResult = RevokeProviderMembershipResponse | ProviderMembershipApiError

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

function providerMembershipApiError(
  data: unknown,
  error: unknown,
  response: { status?: number } | undefined,
  fallback: string,
): ProviderMembershipApiError {
  const status = response?.status ?? readStatus(error) ?? readStatus(data)
  const message = readErrorMessage(data) ?? readErrorMessage(error) ?? defaultErrorForStatus(status, fallback)
  const result: ProviderMembershipApiError = { success: false, error: message }
  if (status !== undefined) {
    result.status = status
  }
  return result
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

function hasCookie(name: string): boolean {
  if (typeof document === 'undefined') {
    return true
  }
  const prefix = `${name}=`
  return document.cookie
    .split(';')
    .map((part) => part.trim())
    .some((part) => part.startsWith(prefix))
}

export async function fetchCurrentAuth(): Promise<CurrentAuth | null> {
  if (!hasCookie('trends_csrf')) {
    return null
  }
  const { data, error } = await rawApiClient.GET<CurrentAuth>('/api/auth/me')
  if (error || !data || data.success !== true) {
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

export type SilentLoginResult =
  | { success: true; login: LocalLoginResponse }
  | { success: false; error: string; status?: number }

/**
 * Exchange a shared HR desk URL token for a normal session cookie.
 * Error strings match API codes: not_configured | invalid_token | disabled | …
 */
export async function silentLoginWithDeskToken(token: string): Promise<SilentLoginResult> {
  const { data, error, response } = await rawApiClient.POST<LocalLoginResponse | { success: false; error: string }>(
    '/api/auth/silent-login',
    { body: { token } },
  )
  if (data && 'success' in data && data.success === true) {
    return { success: true, login: data }
  }
  const status = response?.status ?? readStatus(error) ?? readStatus(data)
  const message =
    readErrorMessage(data) ?? readErrorMessage(error) ?? defaultErrorForStatus(status, 'Silent login failed')
  const result: SilentLoginResult = { success: false, error: message }
  if (status !== undefined) {
    result.status = status
  }
  return result
}

export type HrDemoSilentLoginInfo = {
  success: true
  configured: boolean
  revealable: boolean
  username: string
  token: string | null
  tokenFingerprint: string | null
  samplePath: string | null
  paramName: 'auth'
}

export type HrDemoSilentLoginInfoResult = HrDemoSilentLoginInfo | ProviderMembershipApiError

/** Admin-only: reveal env-backed AUTH_HR_DEMO_TOKEN for bookmark handoff. */
export async function fetchHrDemoSilentLoginInfo(): Promise<HrDemoSilentLoginInfoResult> {
  const { data, error, response } = await rawApiClient.GET<HrDemoSilentLoginInfo | ProviderMembershipApiError>(
    '/api/auth/hr-demo-silent',
  )
  if (data && 'success' in data && data.success === true) {
    return data
  }
  return providerMembershipApiError(data, error, response, 'Failed to load HR demo silent-login config')
}

/** Remove only the `auth` query param; keep filters and hash. Returns true if the URL changed. */
export function stripAuthQueryParam(url: URL = new URL(window.location.href)): boolean {
  if (!url.searchParams.has('auth')) {
    return false
  }
  url.searchParams.delete('auth')
  const next = `${url.pathname}${url.search}${url.hash}`
  window.history.replaceState(window.history.state, '', next)
  return true
}

export function readAuthQueryToken(search: string = window.location.search): string | null {
  const value = new URLSearchParams(search).get('auth')
  if (!value || !value.trim()) {
    return null
  }
  return value
}

export async function logout(): Promise<boolean> {
  const { data, error } = await rawApiClient.POST<{ success: boolean }>('/api/auth/logout')
  return !error && data?.success === true
}

export async function fetchProviderMemberships(): Promise<ProviderMembershipsResult> {
  const { data, error, response } = await rawApiClient.GET<ProviderMembershipsResult>('/api/auth/provider-memberships')
  if (data?.success === true) {
    return data
  }
  return providerMembershipApiError(data, error, response, 'Failed to load provider membership state')
}

export async function preapproveProviderMembership(
  input: PreapproveProviderMembershipInput,
): Promise<PreapproveProviderMembershipResult> {
  const { data, error, response } = await rawApiClient.POST<PreapproveProviderMembershipResult>(
    '/api/auth/provider-memberships/preapprove',
    { body: input },
  )
  if (data?.success === true) {
    return data
  }
  return providerMembershipApiError(data, error, response, 'Failed to grant provider access')
}

export async function revokeProviderMembership(
  input: RevokeProviderMembershipInput,
): Promise<RevokeProviderMembershipResult> {
  const { data, error, response } = await rawApiClient.POST<RevokeProviderMembershipResult>(
    '/api/auth/provider-memberships/revoke',
    { body: input },
  )
  if (data?.success === true) {
    return data
  }
  return providerMembershipApiError(data, error, response, 'Failed to revoke provider access')
}

export function getCasdoorLoginUrl(redirectTo: string = getCurrentRedirectPath()): string {
  const params = new URLSearchParams({ redirectTo: sanitizeRedirectPath(redirectTo) })
  return `${joinApiPath('/api/auth/casdoor/login')}?${params.toString()}`
}

export function redirectToCasdoorLogin(redirectTo?: string): void {
  window.location.assign(getCasdoorLoginUrl(redirectTo))
}

export type ChangePasswordResult =
  | { success: true }
  | { success: false; error: string; status?: number }

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  const { data, error, response } = await rawApiClient.POST<{ success: true }>(
    '/api/auth/change-password',
    { body: { currentPassword, newPassword } },
  )
  if (data?.success === true) {
    return data
  }
  const status = response?.status ?? readStatus(error) ?? readStatus(data)
  const message = readErrorMessage(data) ?? readErrorMessage(error) ?? defaultErrorForStatus(status, 'Failed to change password')
  const result: ChangePasswordResult = { success: false, error: message }
  if (status !== undefined) {
    result.status = status
  }
  return result
}
