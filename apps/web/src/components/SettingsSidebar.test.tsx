import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const workspaceState = vi.hoisted(() => ({
  isAdmin: true,
}))

const authState = vi.hoisted(() => ({
  memberships: [] as Array<{ userId: string; workspaceSlug: string; role: string }>,
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ memberships: authState.memberships }),
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    slug: 'dev',
    name: 'Dev',
    isAdmin: workspaceState.isAdmin,
  }),
}))

vi.mock('@/hooks/useSystemMetadata', () => ({
  useSystemMetadata: () => ({ identity: { appVersion: '2.1.0' }, navigation: {} }),
}))

vi.mock('@trends/shared', () => ({
  APP_SURFACE_IDENTITY: { appName: 'Trends', settingsBadgeLabel: 'ADMIN', settingsTitle: 'Settings' },
  SETTINGS_NAV_ITEMS: [
    { id: 'home', titleKey: 'nav.home', defaultTitle: 'Home', hrefSuffix: '/resumes', matchesSuffixes: ['/resumes'] },
    { id: 'setup', titleKey: 'settings.setup.nav', defaultTitle: 'Setup', hrefSuffix: '/settings/setup', matchesSuffixes: ['/settings/setup'] },
    { id: 'keywords', titleKey: 'settings.searchSetup.nav', defaultTitle: 'Search setup', hrefSuffix: '/settings/keywords', matchesSuffixes: ['/settings/keywords'] },
    { id: 'policies', titleKey: 'settings.policies.nav', defaultTitle: 'Policies', hrefSuffix: '/settings/policies', matchesSuffixes: ['/settings/policies', '/settings/blocks'] },
    { id: 'export-fields', titleKey: 'nav.exportFields', defaultTitle: 'Export Fields', hrefSuffix: '/settings/export-fields', matchesSuffixes: ['/settings/export-fields'] },
    { id: 'industry-verification', titleKey: 'nav.industryVerification', defaultTitle: 'Industry verification', hrefSuffix: '/system/settings/industry-verification', matchesSuffixes: ['/system/settings/industry-verification'], requiresReviewAccess: true },
  ],
}))

import { SettingsSidebar } from '@/components/SettingsSidebar'

function renderWithRouter(ui: React.ReactElement, path = '/dev/resumes') {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>)
}

describe('SettingsSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workspaceState.isAdmin = true
    authState.memberships = []
  })

  it('renders app name badge', () => {
    renderWithRouter(<SettingsSidebar />)
    expect(screen.getByText('ADMIN')).toBeInTheDocument()
  })

  it('renders navigation items', () => {
    renderWithRouter(<SettingsSidebar />)
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Setup')).toBeInTheDocument()
    expect(screen.getByText('Search setup')).toBeInTheDocument()
    expect(screen.getByText('Policies')).toBeInTheDocument()
    expect(screen.getByText('Export Fields')).toBeInTheDocument()
  })

  it('shows export fields navigation for non-admin workspaces', () => {
    workspaceState.isAdmin = false

    renderWithRouter(<SettingsSidebar />)

    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Export Fields')).toBeInTheDocument()
  })

  it('highlights active navigation item', () => {
    renderWithRouter(<SettingsSidebar />, '/dev/settings/keywords')
    const searchSetupLink = screen.getByText('Search setup').closest('a')
    expect(searchSetupLink?.className).toContain('bg-primary/10')
  })

  it('renders app version', () => {
    renderWithRouter(<SettingsSidebar />)
    expect(screen.getByText(/v2\.1\.0/)).toBeInTheDocument()
  })

  it('renders close button when onClose is provided', () => {
    const onClose = vi.fn()
    renderWithRouter(<SettingsSidebar onClose={onClose} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('calls onClose when close button clicked', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderWithRouter(<SettingsSidebar onClose={onClose} />)
    await user.click(screen.getByRole('button'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows the industry verification entry to an active-workspace reviewer', () => {
    workspaceState.isAdmin = false
    authState.memberships = [{ userId: 'u1', workspaceSlug: 'dev', role: 'reviewer' }]

    renderWithRouter(<SettingsSidebar />)

    const link = screen.getByRole('link', { name: 'Industry verification' })
    expect(link).toHaveAttribute('href', '/dev/system/settings/industry-verification')
  })

  it('shows the industry verification entry to an active-workspace admin', () => {
    authState.memberships = [{ userId: 'u1', workspaceSlug: 'dev', role: 'admin' }]

    renderWithRouter(<SettingsSidebar />)

    expect(screen.getByRole('link', { name: 'Industry verification' })).toBeInTheDocument()
  })

  it('hides the industry verification entry from plain members', () => {
    workspaceState.isAdmin = false
    authState.memberships = [{ userId: 'u1', workspaceSlug: 'dev', role: 'user' }]

    renderWithRouter(<SettingsSidebar />)

    expect(screen.queryByRole('link', { name: 'Industry verification' })).not.toBeInTheDocument()
  })

  it('hides the industry verification entry from a reviewer of another workspace', () => {
    workspaceState.isAdmin = false
    authState.memberships = [{ userId: 'u1', workspaceSlug: 'hr', role: 'reviewer' }]

    renderWithRouter(<SettingsSidebar />)

    expect(screen.queryByRole('link', { name: 'Industry verification' })).not.toBeInTheDocument()
  })
})
