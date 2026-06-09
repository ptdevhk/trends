import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { fetchCurrentAuth, loginWithLocalPassword, logout as logoutApi, type CurrentAuth, type AuthUser, type WorkspaceRole } from '@/lib/auth'

type AuthState = {
  user: AuthUser | null
  workspaceRole: WorkspaceRole | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (username: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  user: null,
  workspaceRole: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => false,
  logout: async () => {},
  refresh: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
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
    void refresh()
  }, [refresh])

  const login = useCallback(async (username: string, password: string): Promise<boolean> => {
    const result = await loginWithLocalPassword(username, password)
    if (result?.success) {
      await refresh()
      return true
    }
    return false
  }, [refresh])

  const logout = useCallback(async () => {
    await logoutApi()
    setAuth(null)
  }, [])

  return (
    <AuthContext.Provider value={{
      user: auth?.user ?? null,
      workspaceRole: auth?.workspaceRole ?? null,
      isAuthenticated: auth?.success === true,
      isLoading,
      login,
      logout,
      refresh,
    }}>
      {children}
    </AuthContext.Provider>
  )
}
