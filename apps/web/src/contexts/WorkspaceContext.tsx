import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'
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
  const location = useLocation()
  const params = useParams()
  const teamSlug = params.teamSlug
  const validSlug = teamSlug && isValidWorkspace(teamSlug) ? teamSlug : null

  const value = useMemo<WorkspaceContextValue>(() => {
    const slug = validSlug ?? 'dev'
    const workspace = WORKSPACE_TEAMS[slug]
    return {
      slug,
      name: workspace.name,
      accessLevel: workspace.accessLevel,
      isAdmin: workspace.accessLevel === 'admin',
    }
  }, [validSlug])

  if (!validSlug) {
    return <Navigate to={{ pathname: '/dev/resumes', search: location.search }} replace />
  }

  workspaceRef.set(validSlug)

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- canonical context pattern: provider + hook
export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext)
  if (!context) {
    throw new Error('useWorkspace must be used within WorkspaceProvider')
  }
  return context
}
