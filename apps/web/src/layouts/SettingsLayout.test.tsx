import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-router-dom', () => ({
  Outlet: () => <div data-testid="outlet" />,
}))

vi.mock('sonner', () => ({
  Toaster: () => <div data-testid="toaster" />,
}))

vi.mock('lucide-react', () => ({
  Menu: () => <svg data-testid="menu-icon" />,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: Record<string, unknown>) => (
    <button {...props}>{children as React.ReactNode}</button>
  ),
}))

vi.mock('@/components/SettingsSidebar', () => ({
  SettingsSidebar: ({ onClose }: { onClose?: () => void }) => <div data-testid="sidebar" onClick={onClose} />,
}))

vi.mock('@/components/Header', () => ({
  Header: ({ leftAction }: { leftAction?: React.ReactNode }) => (
    <header data-testid="header">{leftAction}</header>
  ),
}))

import SettingsLayout from '@/layouts/SettingsLayout'

describe('SettingsLayout', () => {
  it('renders header, sidebar, outlet, and toaster with no mobile menu initially', () => {
    render(<SettingsLayout />)
    expect(screen.getByTestId('header')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
    expect(screen.getByTestId('toaster')).toBeInTheDocument()
    expect(screen.getAllByTestId('sidebar')).toHaveLength(1)
  })

  it('renders mobile menu toggle button', () => {
    render(<SettingsLayout />)
    expect(screen.getByRole('button', { name: /toggle menu/i })).toBeInTheDocument()
  })

  it('opens and closes mobile menu via toggle', async () => {
    const user = userEvent.setup()
    render(<SettingsLayout />)

    await user.click(screen.getByRole('button', { name: /toggle menu/i }))
    expect(screen.getAllByTestId('sidebar')).toHaveLength(2)

    const sidebars = screen.getAllByTestId('sidebar')
    await user.click(sidebars[1])
    expect(screen.getAllByTestId('sidebar')).toHaveLength(1)
  })
})
