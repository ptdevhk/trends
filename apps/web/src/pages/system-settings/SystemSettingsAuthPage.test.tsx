import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetchProviderMemberships = vi.hoisted(() => vi.fn())
const mockPreapproveProviderMembership = vi.hoisted(() => vi.fn())
const mockRevokeProviderMembership = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth', () => ({
  fetchProviderMemberships: mockFetchProviderMemberships,
  preapproveProviderMembership: mockPreapproveProviderMembership,
  revokeProviderMembership: mockRevokeProviderMembership,
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'hr' }),
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

  it('hides admin controls when provider membership state cannot be loaded', async () => {
    mockFetchProviderMemberships.mockResolvedValueOnce(null)
    render(<SystemSettingsAuthPage />)

    await waitFor(() => {
      expect(screen.getByText('Admin access required')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('auth-preapprove-submit')).not.toBeInTheDocument()
    expect(screen.queryByTestId('auth-revoke-sub-1-hr')).not.toBeInTheDocument()
  })
})
