import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetchProviderMemberships = vi.hoisted(() => vi.fn())
const mockPreapproveProviderMembership = vi.hoisted(() => vi.fn())
const mockRevokeProviderMembership = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
const authMock = vi.hoisted(() => ({
  value: {
    user: { id: 'admin-1', email: 'admin@example.com', displayName: 'Admin User', status: 'active' as const },
    workspaceRole: 'admin' as const,
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(async () => true),
    logout: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
  },
}))

vi.mock('@/lib/auth', () => ({
  fetchProviderMemberships: mockFetchProviderMemberships,
  preapproveProviderMembership: mockPreapproveProviderMembership,
  revokeProviderMembership: mockRevokeProviderMembership,
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'hr' }),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authMock.value,
}))

vi.mock('sonner', () => ({
  toast: mockToast,
}))

import { SystemSettingsAuthPage } from './SystemSettingsAuthPage'

const providerMemberships = {
  success: true as const,
  identities: [
    {
      provider: 'casdoor' as const,
      providerSubject: 'sub-1',
      providerTenant: 'tenant-1',
      userId: 'user-1',
      email: 'casdoor@example.com',
      displayName: 'Casdoor User',
      updatedAt: '2026-06-08T00:00:00.000Z',
    },
  ],
  preapprovals: [
    {
      provider: 'casdoor' as const,
      providerSubject: 'sub-1',
      providerTenant: 'tenant-1',
      workspaceSlug: 'hr',
      role: 'user' as const,
      operatorId: 'admin-1',
      active: true,
      createdAt: '2026-06-08T00:00:00.000Z',
      updatedAt: '2026-06-08T00:00:00.000Z',
    },
  ],
  grants: [
    {
      provider: 'casdoor' as const,
      providerSubject: 'sub-1',
      providerTenant: 'tenant-1',
      workspaceSlug: 'hr',
      role: 'user' as const,
      userId: 'user-1',
      preapprovalId: 'preapproval-1',
      active: true,
      grantedAt: '2026-06-08T00:00:00.000Z',
    },
  ],
  events: [
    {
      id: 'event-1',
      type: 'workspace_membership_granted',
      provider: 'casdoor',
      userId: 'user-1',
      workspaceSlug: 'hr',
      createdAt: '2026-06-08T00:00:00.000Z',
    },
  ],
}

describe('SystemSettingsAuthPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchProviderMemberships.mockResolvedValue(providerMemberships)
  })

  it('renders provider identities, preapprovals, grants, form controls, and events', async () => {
    render(<SystemSettingsAuthPage />)

    expect(await screen.findByText('Casdoor User')).toBeInTheDocument()
    expect(screen.getByText('casdoor@example.com')).toBeInTheDocument()
    expect(screen.getAllByText('sub-1').length).toBeGreaterThan(1)
    expect(screen.getAllByText('tenant-1').length).toBeGreaterThan(1)
    expect(screen.getByText('workspace_membership_granted')).toBeInTheDocument()
    expect(screen.getByTestId('auth-provider-subject-input')).toBeInTheDocument()
    expect(screen.getByTestId('auth-provider-tenant-input')).toBeInTheDocument()
    expect(screen.getByTestId('auth-workspace-input')).toBeInTheDocument()
    expect(screen.getByTestId('auth-role-select')).toBeInTheDocument()
    expect(screen.getByTestId('auth-preapprove-submit')).toBeInTheDocument()
    expect(screen.getByTestId('auth-revoke-sub-1-hr')).toBeInTheDocument()
  })

  it('renders workspace role policy and disabled role editor controls', async () => {
    render(<SystemSettingsAuthPage />)

    expect(await screen.findByText('Workspace access policy')).toBeInTheDocument()
    expect(screen.getByText('Everyone / anonymous')).toBeInTheDocument()
    expect(screen.getAllByText('resume:search').length).toBeGreaterThan(0)
    expect(screen.getByText('Current user role')).toBeInTheDocument()
    expect(screen.getByText('Admin User')).toBeInTheDocument()
    expect(screen.getByText('admin@example.com')).toBeInTheDocument()
    expect(screen.getByText('Workspace admin')).toBeInTheDocument()
    expect(screen.getByText('Role editor backend pending')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-role-editor-placeholder')).toBeDisabled()
    expect(screen.getByText('Provider-derived grants')).toBeInTheDocument()
  })

  it('creates a provider preapproval from the form', async () => {
    mockPreapproveProviderMembership.mockResolvedValue({
      success: true,
      preapproval: providerMemberships.preapprovals[0],
      appliedMemberships: [],
    })
    const user = userEvent.setup()
    render(<SystemSettingsAuthPage />)

    await screen.findByText('Casdoor User')
    await user.clear(screen.getByTestId('auth-provider-subject-input'))
    await user.type(screen.getByTestId('auth-provider-subject-input'), 'sub-2')
    await user.clear(screen.getByTestId('auth-provider-tenant-input'))
    await user.type(screen.getByTestId('auth-provider-tenant-input'), 'tenant-2')
    await user.clear(screen.getByTestId('auth-workspace-input'))
    await user.type(screen.getByTestId('auth-workspace-input'), 'hr')
    await user.selectOptions(screen.getByTestId('auth-role-select'), 'admin')
    await user.click(screen.getByTestId('auth-preapprove-submit'))

    expect(mockPreapproveProviderMembership).toHaveBeenCalledWith({
      provider: 'casdoor',
      providerSubject: 'sub-2',
      providerTenant: 'tenant-2',
      workspaceSlug: 'hr',
      role: 'admin',
    })
  })

  it('revokes a provider preapproval after explicit confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    mockRevokeProviderMembership.mockResolvedValue({
      success: true,
      revoked: { ...providerMemberships.preapprovals[0], active: false },
    })
    const user = userEvent.setup()
    render(<SystemSettingsAuthPage />)

    await user.click(await screen.findByTestId('auth-revoke-sub-1-hr'))

    expect(window.confirm).toHaveBeenCalled()
    expect(mockRevokeProviderMembership).toHaveBeenCalledWith({
      provider: 'casdoor',
      providerSubject: 'sub-1',
      providerTenant: 'tenant-1',
      workspaceSlug: 'hr',
    })
  })

  it('hides admin controls and shows provider membership load errors', async () => {
    mockFetchProviderMemberships.mockResolvedValueOnce({
      success: false,
      status: 403,
      error: 'Admin access required',
    })
    render(<SystemSettingsAuthPage />)

    await waitFor(() => {
      expect(screen.getByText('Admin access required (403)')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('auth-preapprove-submit')).not.toBeInTheDocument()
    expect(screen.queryByTestId('auth-revoke-sub-1-hr')).not.toBeInTheDocument()
  })

  it('shows provider preapproval error messages from the API', async () => {
    mockPreapproveProviderMembership.mockResolvedValueOnce({
      success: false,
      status: 400,
      error: 'Invalid workspace',
    })
    const user = userEvent.setup()
    render(<SystemSettingsAuthPage />)

    await screen.findByText('Casdoor User')
    await user.clear(screen.getByTestId('auth-provider-subject-input'))
    await user.type(screen.getByTestId('auth-provider-subject-input'), 'sub-2')
    await user.clear(screen.getByTestId('auth-provider-tenant-input'))
    await user.type(screen.getByTestId('auth-provider-tenant-input'), 'tenant-2')
    await user.clear(screen.getByTestId('auth-workspace-input'))
    await user.type(screen.getByTestId('auth-workspace-input'), 'prod')
    await user.click(screen.getByTestId('auth-preapprove-submit'))

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Invalid workspace')
    })
  })

  it('shows provider revocation error messages from the API', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    mockRevokeProviderMembership.mockResolvedValueOnce({
      success: false,
      status: 404,
      error: 'Provider membership preapproval not found',
    })
    const user = userEvent.setup()
    render(<SystemSettingsAuthPage />)

    await user.click(await screen.findByTestId('auth-revoke-sub-1-hr'))

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Provider membership preapproval not found')
    })
    confirmSpy.mockRestore()
  })
})
