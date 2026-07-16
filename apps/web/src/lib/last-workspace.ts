import { isValidWorkspace, type WorkspaceSlug } from '@trends/shared'
import type { WorkspaceMembership } from '@/lib/auth'
import { hasWorkspaceMembership } from '@/lib/workspace-access'

const storageKey = (userId: string) => `trends.lastWorkspace.${userId}`

export function readLastWorkspaceSlug(userId: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(storageKey(userId))
    return value && isValidWorkspace(value) ? value : null
  } catch {
    return null
  }
}

export function writeLastWorkspaceSlug(userId: string, workspaceSlug: string): void {
  if (typeof window === 'undefined') return
  if (!isValidWorkspace(workspaceSlug)) return
  try {
    window.localStorage.setItem(storageKey(userId), workspaceSlug)
  } catch {
    // ignore quota / private mode
  }
}

/**
 * Prefer last selected seat if still a membership; else first non-system; else first membership.
 */
export function resolvePreferredWorkspaceSlug(
  userId: string | null | undefined,
  memberships: readonly WorkspaceMembership[],
  systemSlugs: readonly string[] = ['dev', 'hr'],
): WorkspaceSlug | null {
  if (memberships.length === 0) return null

  if (userId) {
    const last = readLastWorkspaceSlug(userId)
    if (last && hasWorkspaceMembership(memberships, last)) {
      return last
    }
  }

  const personal = memberships.find((m) => !systemSlugs.includes(m.workspaceSlug))
  if (personal && isValidWorkspace(personal.workspaceSlug)) {
    return personal.workspaceSlug
  }

  const first = memberships.find((m) => isValidWorkspace(m.workspaceSlug))
  return first?.workspaceSlug ?? null
}
