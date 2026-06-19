import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCreateAdminUser = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('@/lib/admin-users', () => ({
  createAdminUser: mockCreateAdminUser,
}))

vi.mock('sonner', () => ({
  toast: mockToast,
}))

import { CreateUserDialog } from './CreateUserDialog'

describe('CreateUserDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows validation error when username is empty', async () => {
    const user = userEvent.setup()
    render(<CreateUserDialog open={true} onOpenChange={vi.fn()} onCreated={vi.fn()} />)

    await user.click(screen.getByTestId('create-user-submit'))

    await waitFor(() => {
      expect(screen.getByText('Username is required')).toBeInTheDocument()
    })
    expect(mockCreateAdminUser).not.toHaveBeenCalled()
  })

  it('shows temp password modal with copy button on success', async () => {
    mockCreateAdminUser.mockResolvedValue({
      success: true,
      user: {
        id: 'user-new',
        displayName: 'newuser',
        status: 'active' as const,
        createdAt: '2026-06-19T00:00:00.000Z',
        identities: [],
        memberships: [],
      },
      temporaryPassword: 'abc123',
    })
    const user = userEvent.setup()
    render(<CreateUserDialog open={true} onOpenChange={vi.fn()} onCreated={vi.fn()} />)

    await user.type(screen.getByTestId('create-user-username'), 'newuser')
    await user.click(screen.getByTestId('create-user-submit'))

    expect(await screen.findByText('abc123')).toBeInTheDocument()
    expect(screen.getByTestId('copy-temp-password')).toBeInTheDocument()
  })

  it('reports the temporary password to the parent on success', async () => {
    mockCreateAdminUser.mockResolvedValue({
      success: true,
      user: {
        id: 'user-new',
        displayName: 'newuser',
        status: 'active' as const,
        createdAt: '2026-06-19T00:00:00.000Z',
        identities: [],
        memberships: [],
      },
      temporaryPassword: 'abc123',
    })
    const onCreated = vi.fn()
    const user = userEvent.setup()
    render(<CreateUserDialog open={true} onOpenChange={vi.fn()} onCreated={onCreated} />)

    await user.type(screen.getByTestId('create-user-username'), 'newuser')
    await user.click(screen.getByTestId('create-user-submit'))

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith('abc123')
    })
  })

  it('keeps password discoverable after close button is clicked', async () => {
    mockCreateAdminUser.mockResolvedValue({
      success: true,
      user: {
        id: 'user-new',
        displayName: 'newuser',
        status: 'active' as const,
        createdAt: '2026-06-19T00:00:00.000Z',
        identities: [],
        memberships: [],
      },
      temporaryPassword: 'abc123',
    })
    const user = userEvent.setup()
    render(<CreateUserDialog open={true} onOpenChange={vi.fn()} onCreated={vi.fn()} />)

    await user.type(screen.getByTestId('create-user-username'), 'newuser')
    await user.click(screen.getByTestId('create-user-submit'))

    expect(await screen.findByText('abc123')).toBeInTheDocument()

    await user.click(screen.getByTestId('close-temp-password'))

    expect(screen.queryByText('abc123')).not.toBeInTheDocument()
  })
})
