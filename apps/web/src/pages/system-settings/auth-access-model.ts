import type { AuthProvider, ProviderMembershipApiError, WorkspaceRole } from '@/lib/auth'

export type FormState = {
  provider: AuthProvider
  providerSubject: string
  providerTenant: string
  workspaceSlug: string
  role: WorkspaceRole
}

export function createInitialForm(workspaceSlug: string): FormState {
  return {
    provider: 'casdoor',
    providerSubject: '',
    providerTenant: '',
    workspaceSlug,
    role: 'user',
  }
}

export function toActionId(value: string): string {
  return value.replace(/[^a-zA-Z0-9-]+/g, '-')
}

export function formatProviderMembershipError(error: ProviderMembershipApiError): string {
  return error.status === undefined ? error.error : `${error.error} (${error.status})`
}
