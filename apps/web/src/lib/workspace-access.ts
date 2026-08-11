import { isValidWorkspace, type WorkspaceSlug } from '@trends/shared'
import type { CurrentAuth, WorkspaceMembership, WorkspaceRole } from '@/lib/auth'
import { resolvePreferredWorkspaceSlug } from '@/lib/last-workspace'

export const SYSTEM_AUTH_WORKSPACE: WorkspaceSlug = 'dev'
export const PUBLIC_RESUME_WORKSPACE: WorkspaceSlug = 'hr'
export const SYSTEM_ROUTE_PREFIX = '/admin/system'

/**
 * Reviewer inherits member access (the API grants reviewers all
 * MEMBER_PERMISSIONS), so the default membership role set includes it.
 */
export function hasWorkspaceMembership(
  memberships: readonly WorkspaceMembership[],
  workspaceSlug: string,
  roles: readonly WorkspaceRole[] = ['user', 'reviewer', 'admin'],
): boolean {
  return memberships.some(
    (membership) => membership.workspaceSlug === workspaceSlug && roles.includes(membership.role),
  )
}

export function hasSystemAdminAccess(memberships: readonly WorkspaceMembership[]): boolean {
  return hasWorkspaceMembership(memberships, SYSTEM_AUTH_WORKSPACE, ['admin'])
}

/**
 * Admin membership of a specific workspace. The industry review surfaces
 * are workspace-scoped: an HR workspace admin can attend the HR industry
 * evidence queue even though the ops-only system settings remain gated on
 * the dev workspace (SYSTEM_AUTH_WORKSPACE).
 */
export function hasWorkspaceAdminAccess(
  memberships: readonly WorkspaceMembership[],
  workspaceSlug: string,
): boolean {
  return hasWorkspaceMembership(memberships, workspaceSlug, ['admin'])
}

/**
 * Admin or reviewer membership of a specific workspace. The industry
 * review surfaces (proposals, evidence sources, verdict revisions,
 * identity resolution) accept the active workspace's reviewer alongside
 * its admin; ops surfaces (recompute runs, maintenance runs, coverage,
 * industry-data administration) stay gated on hasWorkspaceAdminAccess.
 */
export function hasWorkspaceIndustryReviewAccess(
  memberships: readonly WorkspaceMembership[],
  workspaceSlug: string,
): boolean {
  return hasWorkspaceMembership(memberships, workspaceSlug, ['admin', 'reviewer'])
}

export function getFirstAuthorizedWorkspaceSlug(
  memberships: readonly WorkspaceMembership[],
): WorkspaceSlug | null {
  const membership = memberships.find((item) => isValidWorkspace(item.workspaceSlug))
  return membership?.workspaceSlug ?? null
}

/**
 * Post-login default: always land on the user's authorized desk
 * (`/{workspaceSlug}/resumes`), never system admin settings.
 * System admin UI stays reachable via explicit nav / redirectTo.
 *
 * Prefer last/personal/first membership via resolvePreferredWorkspaceSlug;
 * that helper already covers first-membership fallback.
 */
export function getDefaultAuthenticatedPath(auth: CurrentAuth, fallbackWorkspaceSlug: WorkspaceSlug): string {
  if (auth.success !== true) {
    return `/${fallbackWorkspaceSlug}/resumes`
  }

  const workspace =
    resolvePreferredWorkspaceSlug(auth.user.id, auth.memberships) ?? fallbackWorkspaceSlug
  return `/${workspace}/resumes`
}

function extractWorkspaceSlugFromRedirect(redirectTo: string): string | null {
  // Paths like /hr/resumes, /dev/settings, /alice/resumes?q=…
  const path = redirectTo.startsWith('/') ? redirectTo : `/${redirectTo}`
  const segment = path.split(/[/?#]/).find(Boolean)
  return segment && isValidWorkspace(segment) ? segment : null
}

/**
 * Allow explicit redirect only when the target is safe for this auth:
 * - system admin routes require dev:admin
 * - workspace-scoped routes require membership on that slug (prevents
 *   config / X-Workspace-Slug mismatch after login)
 */
export function canUseExplicitRedirect(auth: CurrentAuth, redirectTo: string): boolean {
  if (auth.success !== true) {
    return false
  }

  if (redirectTo.startsWith(`${SYSTEM_ROUTE_PREFIX}/`) || redirectTo === SYSTEM_ROUTE_PREFIX) {
    return hasSystemAdminAccess(auth.memberships)
  }

  const workspaceSlug = extractWorkspaceSlugFromRedirect(redirectTo)
  if (workspaceSlug) {
    return hasWorkspaceMembership(auth.memberships, workspaceSlug)
  }

  return true
}
