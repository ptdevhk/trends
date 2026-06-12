import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

const mockState = vi.hoisted(() => ({
  slug: 'dev',
  navigate: vi.fn(),
}))

const mockAuthState = vi.hoisted(() => ({
  isAuthenticated: false,
  memberships: [] as Array<{ userId: string; workspaceSlug: string; role: 'user' | 'admin' }>,
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockState.navigate,
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    slug: mockState.slug,
  }),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockAuthState,
}))

describe('WorkspaceSwitcher', () => {
  beforeEach(() => {
    mockState.slug = 'dev'
    mockState.navigate.mockReset()
    mockAuthState.isAuthenticated = false
    mockAuthState.memberships = []
  })

  it('navigates to the selected workspace resume home without preserving query state', () => {
    render(<WorkspaceSwitcher />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace switcher' }), {
      target: { value: 'hr' },
    })

    expect(mockState.navigate).toHaveBeenCalledWith('/hr/resumes')
    expect(mockState.navigate).toHaveBeenCalledTimes(1)
  })

  it('shows only workspaces the signed-in user belongs to', () => {
    mockAuthState.isAuthenticated = true
    mockAuthState.memberships = [{ userId: 'demo-admin', workspaceSlug: 'dev', role: 'admin' }]

    render(<WorkspaceSwitcher />)

    expect(screen.getByRole('option', { name: 'Development' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'HR Team' })).not.toBeInTheDocument()
  })
})
