import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    slug: 'dev',
    name: 'Development',
    isAdmin: false,
    isSystemSurface: true,
  }),
}))

vi.mock('@/hooks/useSystemMetadata', () => ({
  useSystemMetadata: () => ({ identity: { appVersion: '3.0.0' }, navigation: {} }),
}))

vi.mock('@trends/shared', () => ({
  APP_SURFACE_IDENTITY: { appName: 'Trends', adminBadgeLabel: 'DEV', systemTitle: 'System' },
  SYSTEM_NAV_ITEMS: [
    { id: 'home', titleKey: 'nav.home', defaultTitle: 'Home', hrefSuffix: '/resumes', matchesSuffixes: ['/resumes'] },
    { id: 'settings', titleKey: 'nav.settings', defaultTitle: 'Settings', hrefSuffix: '/system/settings', matchesSuffixes: ['/system/settings'] },
  ],
}))

import { SystemSidebar } from '@/components/SystemSidebar'

function renderWithRouter(ui: React.ReactElement, path = '/admin/system') {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>)
}

describe('SystemSidebar', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders admin badge', () => {
    renderWithRouter(<SystemSidebar />)
    expect(screen.getByText('DEV')).toBeInTheDocument()
  })

  it('renders navigation items', () => {
    renderWithRouter(<SystemSidebar />)
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('highlights active navigation item', () => {
    renderWithRouter(<SystemSidebar />, '/admin/system/settings')
    const settingsLink = screen.getByText('Settings').closest('a')
    expect(settingsLink?.className).toContain('bg-primary/10')
  })

  it('renders app version', () => {
    renderWithRouter(<SystemSidebar />)
    expect(screen.getByText(/v3\.0\.0/)).toBeInTheDocument()
  })

  it('renders close button when onClose provided', () => {
    renderWithRouter(<SystemSidebar onClose={vi.fn()} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('calls onClose when close button clicked', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderWithRouter(<SystemSidebar onClose={onClose} />)
    await user.click(screen.getByRole('button'))
    expect(onClose).toHaveBeenCalled()
  })

  it('does not render close button without onClose', () => {
    renderWithRouter(<SystemSidebar />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
