import { getWorkspaceDisplayName, isValidWorkspace, listSystemWorkspaceSlugs } from '@trends/shared'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { writeLastWorkspaceSlug } from '@/lib/last-workspace'
import { hasWorkspaceMembership } from '@/lib/workspace-access'

export function WorkspaceSwitcher() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { slug } = useWorkspace()
  const { isAuthenticated, memberships, user } = useAuth()

  const entries = isAuthenticated
    ? memberships
      .map((m) => m.workspaceSlug)
      .filter((workspaceSlug): workspaceSlug is string => isValidWorkspace(workspaceSlug))
      .filter((workspaceSlug, index, all) => all.indexOf(workspaceSlug) === index)
      .sort((a, b) => {
        const system = listSystemWorkspaceSlugs() as string[]
        const aSys = system.includes(a) ? 0 : 1
        const bSys = system.includes(b) ? 0 : 1
        if (aSys !== bSys) return aSys - bSys
        return a.localeCompare(b)
      })
    : listSystemWorkspaceSlugs()

  // When authenticated, only show seats the user can enter
  const visible = isAuthenticated
    ? entries.filter((workspaceSlug) => hasWorkspaceMembership(memberships, workspaceSlug))
    : entries

  return (
    <select
      value={slug}
      onChange={(event) => {
        const nextSlug = event.target.value
        if (user?.id) {
          writeLastWorkspaceSlug(user.id, nextSlug)
        }
        navigate(`/${nextSlug}/resumes`)
      }}
      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
      aria-label={t('common.workspaceSwitcherAria', { defaultValue: 'Workspace switcher' })}
      data-testid="workspace-switcher"
    >
      {visible.map((workspaceSlug) => (
        <option key={workspaceSlug} value={workspaceSlug}>
          {getWorkspaceDisplayName(workspaceSlug)}
        </option>
      ))}
    </select>
  )
}
