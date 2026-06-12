import { WORKSPACE_TEAMS } from '@trends/shared'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { hasWorkspaceMembership } from '@/lib/workspace-access'

export function WorkspaceSwitcher() {
  const navigate = useNavigate()
  const { slug } = useWorkspace()
  const { isAuthenticated, memberships } = useAuth()
  const entries = Object.entries(WORKSPACE_TEAMS).filter(([workspaceSlug]) => (
    !isAuthenticated || hasWorkspaceMembership(memberships, workspaceSlug)
  ))

  return (
    <select
      value={slug}
      onChange={(event) => {
        const nextSlug = event.target.value
        navigate(`/${nextSlug}/resumes`)
      }}
      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
      aria-label="Workspace switcher"
    >
      {entries.map(([workspaceSlug, team]) => (
        <option key={workspaceSlug} value={workspaceSlug}>
          {team.name}
        </option>
      ))}
    </select>
  )
}
