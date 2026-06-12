import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'

const mockUseParams = vi.hoisted(() => vi.fn())
const mockUseLocation = vi.hoisted(() => vi.fn())
const mockNavigate = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useParams: mockUseParams,
  useLocation: mockUseLocation,
  Navigate: ({ to }: { to: { pathname: string } }) => {
    mockNavigate(to)
    return <div>Redirect to {to.pathname}</div>
  },
}))

vi.mock('@trends/shared', () => ({
  WORKSPACE_TEAMS: {
    dev: { name: 'Development', accessLevel: 'user' },
    hr: { name: 'HR Team', accessLevel: 'user' },
  },
  isValidWorkspace: (s: string) => s === 'dev' || s === 'hr',
}))

import { WorkspaceProvider, useWorkspace } from '@/contexts/WorkspaceContext'

function TestConsumer() {
  const ws = useWorkspace()
  return <div data-testid="ws">{ws.slug}:{ws.name}:{ws.accessLevel}:{String(ws.isAdmin)}</div>
}

function renderWithProvider(slug: string | undefined, children: ReactNode) {
  mockUseParams.mockReturnValue({ teamSlug: slug })
  mockUseLocation.mockReturnValue({ search: '' })
  return render(<WorkspaceProvider>{children}</WorkspaceProvider>)
}

describe('WorkspaceProvider', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('redirects for admin because it is a system namespace, not a workspace', () => {
    renderWithProvider('admin', <TestConsumer />)
    expect(mockNavigate).toHaveBeenCalledWith({ pathname: '/dev/resumes', search: '' })
  })

  it('provides context for valid dev slug', () => {
    renderWithProvider('dev', <TestConsumer />)
    expect(screen.getByTestId('ws')).toHaveTextContent('dev:Development:user:false')
  })

  it('supports fixed backing workspaces for public and system surfaces', () => {
    mockUseParams.mockReturnValue({ teamSlug: undefined })
    mockUseLocation.mockReturnValue({ search: '' })

    render(
      <WorkspaceProvider workspaceSlug="hr" surface="public">
        <TestConsumer />
      </WorkspaceProvider>,
    )

    expect(screen.getByTestId('ws')).toHaveTextContent('hr:HR Team:user:false')
  })

  it('redirects for invalid slug', () => {
    renderWithProvider('invalid', <TestConsumer />)
    expect(mockNavigate).toHaveBeenCalledWith({ pathname: '/dev/resumes', search: '' })
  })

  it('redirects for undefined slug', () => {
    renderWithProvider(undefined, <TestConsumer />)
    expect(mockNavigate).toHaveBeenCalledWith({ pathname: '/dev/resumes', search: '' })
  })
})

describe('useWorkspace', () => {
  it('throws when used outside provider', () => {
    expect(() => render(<TestConsumer />)).toThrow('useWorkspace must be used within WorkspaceProvider')
  })
})
