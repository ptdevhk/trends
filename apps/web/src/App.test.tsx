import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { workspaceRef } from '@/lib/workspace-ref'

const routeTestState = vi.hoisted(() => ({
  reviewPacketsShouldThrow: false,
}))

const authState = vi.hoisted(() => ({
  user: null as null | { id: string; status: 'active'; displayName?: string },
  memberships: [] as Array<{ userId: string; workspaceSlug: string; role: 'user' | 'admin' }>,
  workspaceRole: null as null | 'user' | 'admin',
  isAuthenticated: false,
  isLoading: false,
}))

vi.mock('@/hooks/useLongTaskObserver', () => ({
  LongTaskObserver: () => null,
}))

vi.mock('@/lib/feature-flags', () => ({
  isReviewPacketsEnabled: () => true,
}))

vi.mock('@/components/Header', () => ({
  Header: () => <header>App header</header>,
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: authState.user,
    memberships: authState.memberships,
    workspaceRole: authState.workspaceRole,
    isAuthenticated: authState.isAuthenticated,
    isLoading: authState.isLoading,
    login: async () => false,
    logout: async () => {},
    refresh: async () => {},
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('@/contexts/AnalysisTasksContext', () => ({
  AnalysisTasksProvider: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('@/contexts/BrandDisplayMapContext', () => ({
  BrandDisplayMapProvider: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('@/contexts/ResumeFieldUsagePolicyContext', () => ({
  ResumeFieldUsagePolicyProvider: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('@/pages/ResumesPage', () => ({
  ResumesPage: () => <div>Resume route rendered</div>,
}))

vi.mock('@/pages/ReviewPacketsPage', () => ({
  ReviewPacketsPage: () => {
    if (routeTestState.reviewPacketsShouldThrow) {
      throw new Error('Review packets exploded')
    }
    return <div>Review packets route rendered</div>
  },
}))

vi.mock('@/pages/PublicSharePage', () => ({
  PublicSharePage: () => <div>Public share route rendered</div>,
}))

vi.mock('@/layouts/SystemLayout', () => ({
  default: () => <div>System layout rendered</div>,
}))

describe('App routes', () => {
  beforeEach(() => {
    authState.user = null
    authState.memberships = []
    authState.workspaceRole = null
    authState.isAuthenticated = false
    authState.isLoading = false
    workspaceRef.set('dev')
  })

  afterEach(() => {
    cleanup()
    routeTestState.reviewPacketsShouldThrow = false
    window.history.replaceState({}, '', '/')
  })

  it('shows a not found page for unknown global routes', async () => {
    window.history.pushState({}, '', '/missing-route?from=test')

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.queryByText('Resume route rendered')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to resumes' })).toHaveAttribute('href', '/dev/resumes')
  })

  it('shows a workspace-aware not found page for unknown workspace routes', async () => {
    authState.user = { id: 'dev-user', status: 'active', displayName: 'Dev User' }
    authState.memberships = [{ userId: 'dev-user', workspaceSlug: 'dev', role: 'user' }]
    authState.workspaceRole = 'user'
    authState.isAuthenticated = true
    window.history.pushState({}, '', '/dev/missing-route')

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.queryByText('Resume route rendered')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to resumes' })).toHaveAttribute('href', '/dev/resumes')
  })

  it('keeps the app shell visible when a non-search route render fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    routeTestState.reviewPacketsShouldThrow = true
    authState.user = { id: 'dev-user', status: 'active', displayName: 'Dev User' }
    authState.memberships = [{ userId: 'dev-user', workspaceSlug: 'dev', role: 'user' }]
    authState.workspaceRole = 'user'
    authState.isAuthenticated = true
    window.history.pushState({}, '', '/dev/review-packets')

    render(<App />)

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Review packets exploded')).toBeInTheDocument()
    expect(screen.getByText('App header')).toBeInTheDocument()

    spy.mockRestore()
  })

  it('renders the anonymous public resume route with hr as the backing workspace', async () => {
    window.history.pushState({}, '', '/resumes')

    render(<App />)

    expect(await screen.findByText('Resume route rendered')).toBeInTheDocument()
    expect(workspaceRef.get()).toBe('hr')
  })

  it('renders public share token routes with hr as the backing public workspace', async () => {
    window.history.pushState({}, '', '/s/public-token-1')

    render(<App />)

    expect(await screen.findByText('Public share route rendered')).toBeInTheDocument()
    expect(workspaceRef.get()).toBe('hr')
  })

  it('renders canonical system routes for dev admins', async () => {
    authState.user = { id: 'demo-admin', status: 'active', displayName: 'Demo Admin' }
    authState.memberships = [{ userId: 'demo-admin', workspaceSlug: 'dev', role: 'admin' }]
    authState.workspaceRole = 'admin'
    authState.isAuthenticated = true
    window.history.pushState({}, '', '/admin/system/settings/auth')

    render(<App />)

    expect(await screen.findByText('System layout rendered')).toBeInTheDocument()
    expect(workspaceRef.get()).toBe('dev')
  })

  it('redirects legacy dev system routes to the canonical admin system route', async () => {
    authState.user = { id: 'demo-admin', status: 'active', displayName: 'Demo Admin' }
    authState.memberships = [{ userId: 'demo-admin', workspaceSlug: 'dev', role: 'admin' }]
    authState.workspaceRole = 'admin'
    authState.isAuthenticated = true
    window.history.pushState({}, '', '/dev/system/settings/auth')

    render(<App />)

    await waitFor(() => expect(window.location.pathname).toBe('/admin/system/settings/auth'))
  })

  it('redirects anonymous system routes through dev login with the original destination', async () => {
    window.history.pushState({}, '', '/admin/system/settings/auth?tab=users')

    render(<App />)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/dev/login')
      expect(window.location.search).toBe('?redirectTo=%2Fadmin%2Fsystem%2Fsettings%2Fauth%3Ftab%3Dusers')
    })
  })

  it('redirects anonymous protected workspace resume routes through workspace login', async () => {
    window.history.pushState({}, '', '/dev/resumes?q=CNC+Sales')

    render(<App />)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/dev/login')
      expect(window.location.search).toBe('?redirectTo=%2Fdev%2Fresumes%3Fq%3DCNC%2BSales')
    })
  })

  it('redirects signed-in users away from workspace routes where they lack membership', async () => {
    authState.user = { id: 'demo-admin', status: 'active', displayName: 'Demo Admin' }
    authState.memberships = [{ userId: 'demo-admin', workspaceSlug: 'dev', role: 'admin' }]
    authState.workspaceRole = 'admin'
    authState.isAuthenticated = true
    window.history.pushState({}, '', '/hr/resumes')

    render(<App />)

    await waitFor(() => expect(window.location.pathname).toBe('/dev/resumes'))
    expect(screen.getByText('Resume route rendered')).toBeInTheDocument()
    expect(workspaceRef.get()).toBe('dev')
  })

  it('redirects signed-in users away from unauthorized workspace settings routes', async () => {
    authState.user = { id: 'demo-admin', status: 'active', displayName: 'Demo Admin' }
    authState.memberships = [{ userId: 'demo-admin', workspaceSlug: 'dev', role: 'admin' }]
    authState.workspaceRole = 'admin'
    authState.isAuthenticated = true
    window.history.pushState({}, '', '/hr/settings')

    render(<App />)

    await waitFor(() => expect(window.location.pathname).toBe('/dev/resumes'))
  })

  it('redirects anonymous hr resume compatibility routes to public resumes', async () => {
    window.history.pushState({}, '', '/hr/resumes?q=CNC')

    render(<App />)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/resumes')
      expect(window.location.search).toBe('?q=CNC')
    })
  })

  it('shows access denied for hr system routes without entering system UI', async () => {
    authState.user = { id: 'hr-admin', status: 'active', displayName: 'HR Admin' }
    authState.memberships = [{ userId: 'hr-admin', workspaceSlug: 'hr', role: 'admin' }]
    authState.workspaceRole = 'admin'
    authState.isAuthenticated = true
    window.history.pushState({}, '', '/hr/system/settings/auth')

    render(<App />)

    expect(await screen.findByText('Admin access required')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Page not found' })).not.toBeInTheDocument()
    expect(screen.queryByText('System layout rendered')).not.toBeInTheDocument()
  })

  it.each(['/admin/resumes', '/admin/settings', '/admin/login'])(
    'treats %s as an invalid workspace-like admin route',
    async (path) => {
      window.history.pushState({}, '', path)

      render(<App />)

      expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
      expect(screen.queryByText('Resume route rendered')).not.toBeInTheDocument()
    },
  )
})
