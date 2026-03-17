import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

const mockState = vi.hoisted(() => ({
  slug: 'dev',
  navigate: vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockState.navigate,
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    slug: mockState.slug,
  }),
}))

describe('WorkspaceSwitcher', () => {
  beforeEach(() => {
    mockState.slug = 'dev'
    mockState.navigate.mockReset()
  })

  it('navigates to the selected workspace resume home without preserving query state', () => {
    render(<WorkspaceSwitcher />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace switcher' }), {
      target: { value: 'hr' },
    })

    expect(mockState.navigate).toHaveBeenCalledWith('/hr/resumes')
    expect(mockState.navigate).toHaveBeenCalledTimes(1)
  })
})
