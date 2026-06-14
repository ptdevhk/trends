import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'
import { WORKSPACE_TEAMS, isValidWorkspace, type WorkspaceSlug } from '@trends/shared'
import { workspaceRef } from '@/lib/workspace-ref'

export type WorkspaceSurface = 'workspace' | 'system' | 'public'

type WorkspaceContextValue = {
  slug: WorkspaceSlug
  name: string
  isAdmin: boolean
  surface: WorkspaceSurface
  isSystemSurface: boolean
  isPublicSurface: boolean
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({
  children,
  invalidFallback,
  workspaceSlug,
  surface = 'workspace',
}: {
  children: ReactNode
  invalidFallback?: ReactNode
  workspaceSlug?: WorkspaceSlug
  surface?: WorkspaceSurface
}) {
  const location = useLocation()
  const params = useParams()
  const teamSlug = workspaceSlug ?? params.teamSlug
  const validSlug = teamSlug && isValidWorkspace(teamSlug) ? teamSlug : null

  const value = useMemo<WorkspaceContextValue>(() => {
    const slug = validSlug ?? 'dev'
    const workspace = WORKSPACE_TEAMS[slug]
    return {
      slug,
      name: workspace.name,
      isAdmin: false,
      surface,
      isSystemSurface: surface === 'system',
      isPublicSurface: surface === 'public',
    }
  }, [surface, validSlug])

  if (!validSlug) {
    if (invalidFallback) {
      return <>{invalidFallback}</>
    }
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
