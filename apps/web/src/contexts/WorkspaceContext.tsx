import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { WORKSPACE_TEAMS, isValidWorkspace, type AccessLevel, type WorkspaceSlug } from '@trends/shared'
import { workspaceRef } from '@/lib/workspace-ref'

type WorkspaceContextValue = {
  slug: WorkspaceSlug
  name: string
  accessLevel: AccessLevel
  isAdmin: boolean
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const params = useParams()
  const teamSlug = params.teamSlug

  if (!teamSlug || !isValidWorkspace(teamSlug)) {
    return <Navigate to="/dev/resumes" replace />
  }

  workspaceRef.set(teamSlug)

  const workspace = WORKSPACE_TEAMS[teamSlug]
  const value = useMemo<WorkspaceContextValue>(() => {
    return {
      slug: teamSlug,
      name: workspace.name,
      accessLevel: workspace.accessLevel,
      isAdmin: workspace.accessLevel === 'admin',
    }
  }, [teamSlug, workspace])

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext)
  if (!context) {
    throw new Error('useWorkspace must be used within WorkspaceProvider')
  }
  return context
}
