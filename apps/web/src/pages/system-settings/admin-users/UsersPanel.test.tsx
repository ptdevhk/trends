import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockListAdminUsers = vi.hoisted(() => vi.fn())
const mockDisableAdminUser = vi.hoisted(() => vi.fn())
const mockEnableAdminUser = vi.hoisted(() => vi.fn())
const mockResetAdminUserPassword = vi.hoisted(() => vi.fn())
const mockUnlockAdminUser = vi.hoisted(() => vi.fn())
const mockListAdminUserAuthEvents = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
const mockReportUiError = vi.hoisted(() => vi.fn())

vi.mock('@/lib/admin-users', () => ({
  listAdminUsers: mockListAdminUsers,
  disableAdminUser: mockDisableAdminUser,
  enableAdminUser: mockEnableAdminUser,
  resetAdminUserPassword: mockResetAdminUserPassword,
  unlockAdminUser: mockUnlockAdminUser,
  listAdminUserAuthEvents: mockListAdminUserAuthEvents,
}))

vi.mock('@/lib/ui-error-reporting', () => ({
  reportUiError: mockReportUiError,
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'admin-1', displayName: 'Admin User' },
  }),
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'dev' }),
}))

vi.mock('sonner', () => ({
  toast: mockToast,
}))

import { UsersPanel } from './UsersPanel'

const sampleUsers = {
  success: true as const,
  users: [
    {
      id: 'user-1',
      email: 'alice@example.com',
      displayName: 'Alice',
      status: 'active' as const,
      createdAt: '2026-06-10T00:00:00.000Z',
      identities: [
        { provider: 'local' as const, providerSubject: 'alice', providerTenant: null },
      ],
      memberships: [{ workspaceSlug: 'dev', role: 'admin' as const }],
    },
    {
      id: 'user-2',
      email: 'bob@example.com',
      displayName: 'Bob',
      status: 'active' as const,
      createdAt: '2026-06-11T00:00:00.000Z',
      identities: [
        { provider: 'local' as const, providerSubject: 'bob', providerTenant: null },
      ],
      memberships: [{ workspaceSlug: 'hr', role: 'user' as const }],
    },
  ],
}

describe('UsersPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListAdminUsers.mockResolvedValue(sampleUsers)
  })

  it('renders the user list', async () => {
    render(<UsersPanel operatorId="admin-1" />)

    expect((await screen.findAllByText('Alice')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('alice@example.com').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Bob').length).toBeGreaterThan(0)
    expect(screen.getAllByText('bob@example.com').length).toBeGreaterThan(0)
    expect(screen.getByTestId('admin-users-stacked')).toBeInTheDocument()
  })

  it('disables then re-enables a user via round-trip', async () => {
    mockDisableAdminUser.mockResolvedValue({ success: true, sessionsRevoked: 0 })
    mockEnableAdminUser.mockResolvedValue({ success: true })
    const user = userEvent.setup()
    render(<UsersPanel operatorId="admin-1" />)

    await screen.findAllByText('Alice')

    // Disable: local state update (no server re-fetch)
    await user.click(screen.getAllByTestId('admin-disable-user-1')[0]!)
    expect(mockDisableAdminUser).toHaveBeenCalledWith('user-1')

    await waitFor(() => {
      expect(screen.getAllByTestId('admin-enable-user-1').length).toBeGreaterThan(0)
    })

    // Re-enable: local state update
    await user.click(screen.getAllByTestId('admin-enable-user-1')[0]!)
    expect(mockEnableAdminUser).toHaveBeenCalledWith('user-1')

    await waitFor(() => {
      expect(screen.getAllByTestId('admin-disable-user-1').length).toBeGreaterThan(0)
    })
  })

  it('shows an access-denied card on 403', async () => {
    mockListAdminUsers.mockResolvedValue({
      success: false,
      error: 'Admin access required',
      status: 403,
    })
    render(<UsersPanel operatorId="admin-1" />)

    expect(await screen.findByText('Admin access required (403)')).toBeInTheDocument()
    expect(screen.queryByText('New user')).not.toBeInTheDocument()
  })

  it('opens the audit drawer when View audit is clicked', async () => {
    mockListAdminUserAuthEvents.mockResolvedValue({ success: true, events: [] })
    const user = userEvent.setup()
    render(<UsersPanel operatorId="admin-1" />)

    await screen.findAllByText('Alice')

    await user.click(screen.getAllByTestId('admin-view-audit-user-1')[0]!)

    await waitFor(() => {
      expect(mockListAdminUserAuthEvents).toHaveBeenCalledWith('user-1')
    })

    expect(await screen.findByTestId('user-audit-drawer')).toBeInTheDocument()
  })
})
