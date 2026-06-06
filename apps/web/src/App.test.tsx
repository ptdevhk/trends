import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const routeTestState = vi.hoisted(() => ({
  reviewPacketsShouldThrow: false,
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
    user: null,
    workspaceRole: null,
    isAuthenticated: false,
    isLoading: false,
    login: async () => false,
    logout: async () => {},
    refresh: async () => {},
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
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

describe('App routes', () => {
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
    window.history.pushState({}, '', '/dev/missing-route')

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.queryByText('Resume route rendered')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to resumes' })).toHaveAttribute('href', '/dev/resumes')
  })

  it('keeps the app shell visible when a non-search route render fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    routeTestState.reviewPacketsShouldThrow = true
    window.history.pushState({}, '', '/dev/review-packets')

    render(<App />)

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Review packets exploded')).toBeInTheDocument()
    expect(screen.getByText('App header')).toBeInTheDocument()

    spy.mockRestore()
  })
})
