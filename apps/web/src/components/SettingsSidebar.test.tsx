import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const workspaceState = vi.hoisted(() => ({
  isAdmin: true,
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
    { id: 'blocks', titleKey: 'nav.blocks', defaultTitle: 'Blocks', hrefSuffix: '/blocks', matchesSuffixes: ['/blocks'] },
    { id: 'export-fields', titleKey: 'nav.exportFields', defaultTitle: 'Export Fields', hrefSuffix: '/settings/export-fields', matchesSuffixes: ['/settings/export-fields'] },
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
  })

  it('renders app name badge', () => {
    renderWithRouter(<SettingsSidebar />)
    expect(screen.getByText('ADMIN')).toBeInTheDocument()
  })

  it('renders navigation items', () => {
    renderWithRouter(<SettingsSidebar />)
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Blocks')).toBeInTheDocument()
    expect(screen.getByText('Export Fields')).toBeInTheDocument()
  })

  it('shows export fields navigation for non-admin workspaces', () => {
    workspaceState.isAdmin = false

    renderWithRouter(<SettingsSidebar />)

    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Export Fields')).toBeInTheDocument()
  })

  it('highlights active navigation item', () => {
    renderWithRouter(<SettingsSidebar />, '/dev/blocks')
    const blocksLink = screen.getByText('Blocks').closest('a')
    expect(blocksLink?.className).toContain('bg-primary/10')
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
})
