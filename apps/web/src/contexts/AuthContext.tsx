import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  fetchCurrentAuth,
  loginWithLocalPassword,
  logout as logoutApi,
  readAuthQueryToken,
  silentLoginWithDeskToken,
  stripAuthQueryParam,
  type CurrentAuth,
  type AuthUser,
  type WorkspaceMembership,
  type WorkspaceRole,
} from '@/lib/auth'

type AuthState = {
  user: AuthUser | null
  memberships: WorkspaceMembership[]
  workspaceRole: WorkspaceRole | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (username: string, password: string) => Promise<CurrentAuth | null>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  user: null,
  memberships: [],
  workspaceRole: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => null,
  logout: async () => {},
  refresh: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

function silentLoginErrorMessage(code: string): string {
  switch (code) {
    case 'not_configured':
      return 'Desk login is not configured on this server.'
    case 'invalid_token':
      return 'Desk login link is invalid or expired.'
    case 'disabled':
      return 'Desk account is disabled or missing HR access.'
    default:
      return code || 'Desk login failed.'
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<CurrentAuth | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refresh = useCallback(async () => {
    const data = await fetchCurrentAuth()
    setAuth(data)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function boot() {
      const deskToken = typeof window !== 'undefined' ? readAuthQueryToken() : null
      if (deskToken) {
        // Always strip so a failed token does not re-fire on every navigation/remount.
        stripAuthQueryParam()
        const silent = await silentLoginWithDeskToken(deskToken)
        if (cancelled) {
          return
        }
        if (!silent.success) {
          toast.error(silentLoginErrorMessage(silent.error))
        }
      }

      if (cancelled) {
        return
      }
      await refresh()
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [refresh])

  const login = useCallback(async (username: string, password: string): Promise<CurrentAuth | null> => {
    const result = await loginWithLocalPassword(username, password)
    if (!result?.success) {
      return null
    }

    const refreshed = await fetchCurrentAuth()
    if (refreshed) {
      setAuth(refreshed)
      setIsLoading(false)
      return refreshed
    }

    const fallback: CurrentAuth = {
      success: true,
      user: result.user,
      memberships: result.memberships,
      workspaceRole: null,
    }
    setAuth(fallback)
    setIsLoading(false)
    return fallback
  }, [])

  const logout = useCallback(async () => {
    await logoutApi()
    setAuth(null)
  }, [])

  const authenticated = auth?.success === true ? auth : null
  return (
    <AuthContext.Provider value={{
      user: authenticated?.user ?? null,
      memberships: authenticated?.memberships ?? [],
      workspaceRole: authenticated?.workspaceRole ?? null,
      isAuthenticated: authenticated !== null,
      isLoading,
      login,
      logout,
      refresh,
    }}>
      {children}
    </AuthContext.Provider>
  )
}
