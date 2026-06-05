import { rawApiClient } from './api-helpers'
import { apiBaseUrl } from './api-client'

export type AuthUser = {
  id: string
  email?: string
  displayName?: string
  status: 'active' | 'disabled'
}

export type WorkspaceRole = 'user' | 'admin'

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

export function getCasdoorLoginUrl(redirectTo: string = getCurrentRedirectPath()): string {
  const params = new URLSearchParams({ redirectTo: sanitizeRedirectPath(redirectTo) })
  return `${joinApiPath('/api/auth/casdoor/login')}?${params.toString()}`
}

export function redirectToCasdoorLogin(redirectTo?: string): void {
  window.location.assign(getCasdoorLoginUrl(redirectTo))
}
