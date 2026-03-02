import { WORKSPACE_TEAMS } from '@trends/shared'
import { useNavigate } from 'react-router-dom'
import { useWorkspace } from '@/contexts/WorkspaceContext'

export function WorkspaceSwitcher() {
  const navigate = useNavigate()
  const { slug } = useWorkspace()

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
      {Object.entries(WORKSPACE_TEAMS).map(([workspaceSlug, team]) => (
        <option key={workspaceSlug} value={workspaceSlug}>
          {team.name}
        </option>
      ))}
    </select>
  )
}
