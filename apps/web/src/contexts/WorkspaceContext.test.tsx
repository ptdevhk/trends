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
    dev: { name: 'Development', accessLevel: 'admin' },
    prod: { name: 'Production', accessLevel: 'member' },
  },
  isValidWorkspace: (s: string) => s === 'dev' || s === 'prod',
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

  it('provides context for valid dev slug', () => {
    renderWithProvider('dev', <TestConsumer />)
    expect(screen.getByTestId('ws')).toHaveTextContent('dev:Development:admin:true')
  })

  it('provides context for valid prod slug', () => {
    renderWithProvider('prod', <TestConsumer />)
    expect(screen.getByTestId('ws')).toHaveTextContent('prod:Production:member:false')
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
