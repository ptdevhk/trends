import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAddAdminUserMembership = vi.hoisted(() => vi.fn())
const mockRemoveAdminUserMembership = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('@/lib/admin-users', () => ({
  addAdminUserMembership: mockAddAdminUserMembership,
  removeAdminUserMembership: mockRemoveAdminUserMembership,
}))

vi.mock('sonner', () => ({
  toast: mockToast,
}))

import { MembershipsDrawer } from './MembershipsDrawer'

const sampleUser = {
  id: 'user-1',
  email: 'alice@example.com',
  displayName: 'Alice',
  status: 'active' as const,
  createdAt: '2026-06-10T00:00:00.000Z',
  identities: [
    { provider: 'local' as const, providerSubject: 'alice', providerTenant: null },
  ],
  memberships: [{ workspaceSlug: 'dev', role: 'admin' as const }],
}

describe('MembershipsDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('adds a new membership row', async () => {
    mockAddAdminUserMembership.mockResolvedValue({ success: true, created: true })
    const user = userEvent.setup()
    render(
      <MembershipsDrawer
        open={true}
        onOpenChange={vi.fn()}
        user={sampleUser}
      />,
    )

    await user.selectOptions(screen.getByTestId('membership-workspace-select'), 'hr')
    await user.click(screen.getByTestId('add-membership-submit'))

    expect(mockAddAdminUserMembership).toHaveBeenCalledWith('user-1', {
      workspaceSlug: 'hr',
      role: 'user',
    })
  })

  it('deletes a membership row', async () => {
    mockRemoveAdminUserMembership.mockResolvedValue({ success: true, deleted: true })
    const user = userEvent.setup()
    render(
      <MembershipsDrawer
        open={true}
        onOpenChange={vi.fn()}
        user={sampleUser}
      />,
    )

    await user.click(screen.getByTestId('remove-membership-dev'))

    expect(mockRemoveAdminUserMembership).toHaveBeenCalledWith('user-1', 'dev')
  })

  it('shows error toast on self-demotion (400 from backend)', async () => {
    mockRemoveAdminUserMembership.mockResolvedValue({
      success: false,
      status: 400,
      error: 'Cannot remove your own admin membership',
    })
    const user = userEvent.setup()
    render(
      <MembershipsDrawer
        open={true}
        onOpenChange={vi.fn()}
        user={sampleUser}
      />,
    )

    await user.click(screen.getByTestId('remove-membership-dev'))

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Cannot remove your own admin membership')
    })
  })
})
