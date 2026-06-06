/**
 * Classifies API errors into auth-specific categories for user-facing messages.
 */

export type AuthErrorType = 'login_required' | 'workspace_access_denied' | 'csrf_expired' | null

export function classifyApiError(status?: number, body?: { error?: string }): AuthErrorType {
  if (status === 401) return 'login_required'
  if (status === 403) {
    const errorMsg = body?.error?.toLowerCase() ?? ''
    if (errorMsg.includes('csrf')) return 'csrf_expired'
    if (errorMsg.includes('workspace')) return 'workspace_access_denied'
    return 'login_required'
  }
  return null
}

export function getAuthErrorTranslationKey(errorType: AuthErrorType): string {
  switch (errorType) {
    case 'login_required':
      return 'auth.loginRequired'
    case 'workspace_access_denied':
      return 'auth.workspaceAccessRequired'
    case 'csrf_expired':
      return 'auth.loginRequired'
    default:
      return ''
  }
}
