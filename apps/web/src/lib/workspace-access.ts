import { isValidWorkspace, type WorkspaceSlug } from '@trends/shared'
import type { CurrentAuth, WorkspaceMembership, WorkspaceRole } from '@/lib/auth'

export const SYSTEM_AUTH_WORKSPACE: WorkspaceSlug = 'dev'
export const PUBLIC_RESUME_WORKSPACE: WorkspaceSlug = 'hr'
export const SYSTEM_ROUTE_PREFIX = '/admin/system'

export function hasWorkspaceMembership(
  memberships: readonly WorkspaceMembership[],
  workspaceSlug: string,
  roles: readonly WorkspaceRole[] = ['user', 'admin'],
): boolean {
  return memberships.some(
    (membership) => membership.workspaceSlug === workspaceSlug && roles.includes(membership.role),
  )
}

export function hasSystemAdminAccess(memberships: readonly WorkspaceMembership[]): boolean {
  return hasWorkspaceMembership(memberships, SYSTEM_AUTH_WORKSPACE, ['admin'])
}

export function getFirstAuthorizedWorkspaceSlug(
  memberships: readonly WorkspaceMembership[],
): WorkspaceSlug | null {
  const membership = memberships.find((item) => isValidWorkspace(item.workspaceSlug))
  return membership && isValidWorkspace(membership.workspaceSlug) ? membership.workspaceSlug : null
}

export function getDefaultAuthenticatedPath(auth: CurrentAuth, fallbackWorkspaceSlug: WorkspaceSlug): string {
  if (hasSystemAdminAccess(auth.memberships)) {
    return `${SYSTEM_ROUTE_PREFIX}/settings/auth`
  }

  const firstWorkspace = getFirstAuthorizedWorkspaceSlug(auth.memberships)
  if (firstWorkspace) {
    return `/${firstWorkspace}/resumes`
  }

  return `/${fallbackWorkspaceSlug}/resumes`
}

export function canUseExplicitRedirect(auth: CurrentAuth, redirectTo: string): boolean {
  if (redirectTo.startsWith(`${SYSTEM_ROUTE_PREFIX}/`) || redirectTo === SYSTEM_ROUTE_PREFIX) {
    return hasSystemAdminAccess(auth.memberships)
  }

  return true
}
