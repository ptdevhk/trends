import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-router-dom', () => ({
  Outlet: () => <div data-testid="outlet" />,
  NavLink: ({ children, to, className }: { children: React.ReactNode; to: string; className?: string | ((props: { isActive: boolean }) => string) }) => {
    const resolvedClass = typeof className === 'function' ? className({ isActive: false }) : className
    return <a href={to} className={resolvedClass} data-testid="nav-link">{children}</a>
  },
}))

vi.mock('@/components/PageHeader', () => ({
  PageHeader: ({ title, description }: { title?: string; description?: string }) => (
    <div data-testid="page-header">
      <div data-testid="header-title">{title}</div>
      <div data-testid="header-desc">{description}</div>
    </div>
  ),
}))

const mockResolveSystemSettingsSubpages = vi.fn()
vi.mock('@/pages/system-settings/lib', () => ({
  resolveSystemSettingsSubpages: (...args: unknown[]) => mockResolveSystemSettingsSubpages(...args),
}))

const mockUseSystemMetadata = vi.fn()
vi.mock('@/hooks/useSystemMetadata', () => ({
  useSystemMetadata: (...args: unknown[]) => mockUseSystemMetadata(...args),
}))

import SystemSettingsLayout from '@/layouts/SystemSettingsLayout'

describe('SystemSettingsLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSystemMetadata.mockReturnValue({
      navigation: {
        systemSettings: [
          { id: 'overview', titleKey: 'tabs.overview', defaultTitle: 'Overview', href: '/dev/system' },
          { id: 'config', titleKey: 'tabs.config', defaultTitle: 'Config Sources', href: '/dev/system/config' },
        ],
      },
    })
    mockResolveSystemSettingsSubpages.mockImplementation((nav: unknown[]) =>
      nav?.map((value) => {
        const item = value as Record<string, unknown>
        return {
          id: item.id,
          titleKey: item.titleKey,
          defaultTitle: item.defaultTitle,
          href: item.href,
        }
      }) ?? []
    )
  })

  it('renders page header with title and description', () => {
    render(<SystemSettingsLayout />)
    expect(screen.getByTestId('page-header')).toBeInTheDocument()
  })

  it('renders nav items from system metadata', () => {
    render(<SystemSettingsLayout />)
    const links = screen.getAllByTestId('nav-link')
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveTextContent('Overview')
    expect(links[1]).toHaveTextContent('Config Sources')
    expect(links[0]).toHaveAttribute('href', '/dev/system')
  })

  it('renders outlet for child routes', () => {
    render(<SystemSettingsLayout />)
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })

  it('handles empty or missing navigation gracefully', () => {
    mockUseSystemMetadata.mockReturnValue({ navigation: { systemSettings: [] } })
    render(<SystemSettingsLayout />)
    expect(screen.queryByTestId('nav-link')).not.toBeInTheDocument()
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })
})
