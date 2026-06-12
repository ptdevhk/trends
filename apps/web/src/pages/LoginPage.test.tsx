import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockNavigate = vi.fn()
const mockSearchParams = new URLSearchParams()
const mockLogin = vi.fn()

function loginResult(workspaceSlug: string, role: 'user' | 'admin' = 'user') {
  return {
    success: true,
    user: {
      id: `${workspaceSlug}-${role}`,
      status: 'active',
    },
    memberships: [{ userId: `${workspaceSlug}-${role}`, workspaceSlug, role }],
    workspaceRole: role,
  }
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [mockSearchParams],
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ login: mockLogin }),
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'dev' }),
}))

import { LoginPage } from './LoginPage'

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams.delete('redirectTo')
  })

  it('renders username and password fields with a submit button', () => {
    render(<LoginPage />)

    expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('submits credentials and navigates to default path on success', async () => {
    mockLogin.mockResolvedValueOnce(loginResult('dev', 'user'))
    const user = userEvent.setup()

    render(<LoginPage />)

    await user.type(screen.getByLabelText(/username/i), 'admin')
    await user.type(screen.getByLabelText(/password/i), 'secret')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(mockLogin).toHaveBeenCalledWith('admin', 'secret')
    expect(mockNavigate).toHaveBeenCalledWith('/dev/resumes', { replace: true })
  })

  it('routes a dev admin login to the system auth settings page by default', async () => {
    mockLogin.mockResolvedValueOnce(loginResult('dev', 'admin'))
    const user = userEvent.setup()

    render(<LoginPage />)

    await user.type(screen.getByLabelText(/username/i), 'demo-admin')
    await user.type(screen.getByLabelText(/password/i), 'demo-admin')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(mockNavigate).toHaveBeenCalledWith('/admin/system/settings/auth', { replace: true })
  })

  it('navigates to redirectTo path on success', async () => {
    mockSearchParams.set('redirectTo', '/dev/settings')
    mockLogin.mockResolvedValueOnce(loginResult('dev', 'admin'))
    const user = userEvent.setup()

    render(<LoginPage />)

    await user.type(screen.getByLabelText(/username/i), 'admin')
    await user.type(screen.getByLabelText(/password/i), 'secret')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(mockNavigate).toHaveBeenCalledWith('/dev/settings', { replace: true })
  })

  it('preserves an explicit system redirect only for dev admins', async () => {
    mockSearchParams.set('redirectTo', '/admin/system/settings/auth')
    mockLogin.mockResolvedValueOnce(loginResult('dev', 'admin'))
    const user = userEvent.setup()

    render(<LoginPage />)

    await user.type(screen.getByLabelText(/username/i), 'demo-admin')
    await user.type(screen.getByLabelText(/password/i), 'demo-admin')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(mockNavigate).toHaveBeenCalledWith('/admin/system/settings/auth', { replace: true })
  })

  it('ignores an explicit system redirect for non-admin users', async () => {
    mockSearchParams.set('redirectTo', '/admin/system/settings/auth')
    mockLogin.mockResolvedValueOnce(loginResult('dev', 'user'))
    const user = userEvent.setup()

    render(<LoginPage />)

    await user.type(screen.getByLabelText(/username/i), 'dev-user')
    await user.type(screen.getByLabelText(/password/i), 'secret')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(mockNavigate).toHaveBeenCalledWith('/dev/resumes', { replace: true })
  })

  it('shows error message on login failure', async () => {
    mockLogin.mockResolvedValueOnce(null)
    const user = userEvent.setup()

    render(<LoginPage />)

    await user.type(screen.getByLabelText(/username/i), 'admin')
    await user.type(screen.getByLabelText(/password/i), 'wrong')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('disables form fields while submitting', async () => {
    let resolveLogin: (value: ReturnType<typeof loginResult>) => void
    mockLogin.mockImplementationOnce(() => new Promise<ReturnType<typeof loginResult>>((resolve) => { resolveLogin = resolve }))
    const user = userEvent.setup()

    render(<LoginPage />)

    await user.type(screen.getByLabelText(/username/i), 'admin')
    await user.type(screen.getByLabelText(/password/i), 'secret')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(screen.getByLabelText(/username/i)).toBeDisabled()
    expect(screen.getByLabelText(/password/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled()

    resolveLogin!(loginResult('dev', 'user'))
  })
})
