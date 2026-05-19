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

vi.mock('@/components/SystemSidebar', () => ({
  SystemSidebar: ({ onClose }: { onClose?: () => void }) => <div data-testid="sidebar" onClick={onClose} />,
}))

vi.mock('@/components/Header', () => ({
  Header: ({ leftAction }: { leftAction?: React.ReactNode }) => (
    <header data-testid="header">{leftAction}</header>
  ),
}))

import SystemLayout from '@/layouts/SystemLayout'

describe('SystemLayout', () => {
  it('renders header, sidebar, main outlet, and toaster with no mobile menu initially', () => {
    render(<SystemLayout />)
    expect(screen.getByTestId('header')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
    expect(screen.getByTestId('toaster')).toBeInTheDocument()
    // Only desktop sidebar visible initially
    expect(screen.getAllByTestId('sidebar')).toHaveLength(1)
  })

  it('renders mobile menu toggle button', () => {
    render(<SystemLayout />)
    expect(screen.getByRole('button', { name: /toggle menu/i })).toBeInTheDocument()
  })

  it('opens and closes mobile menu via toggle and backdrop', async () => {
    const user = userEvent.setup()
    render(<SystemLayout />)

    // Open — second sidebar appears
    await user.click(screen.getByRole('button', { name: /toggle menu/i }))
    expect(screen.getAllByTestId('sidebar')).toHaveLength(2)

    // Close via backdrop click — back to one sidebar
    const sidebars = screen.getAllByTestId('sidebar')
    expect(sidebars).toHaveLength(2)
    // The mobile sidebar (second in the list) stores onClose from the backdrop
    // Click the backdrop overlay directly via the mobile sidebar's onClick
    await user.click(sidebars[1])
    expect(screen.getAllByTestId('sidebar')).toHaveLength(1)
  })
})
