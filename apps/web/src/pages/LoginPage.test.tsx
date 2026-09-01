import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockNavigate = vi.fn()
const mockSearchParams = new URLSearchParams()
const mockLogin = vi.fn()
const mockLastLoginError: { status?: number; retryAfterSeconds?: number; message?: string } = {}

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

const mockT = (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [mockSearchParams],
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ login: mockLogin, lastLoginError: mockLastLoginError }),
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'dev' }),
}))

import { LoginPage } from './LoginPage'

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams.delete('redirectTo')
    mockLastLoginError.status = undefined
    mockLastLoginError.retryAfterSeconds = undefined
    mockLastLoginError.message = undefined
  })

  async function submitLogin(username: string, password: string) {
    const user = userEvent.setup()
    render(<LoginPage />)
    await user.type(screen.getByLabelText(/username/i), username)
    await user.type(screen.getByLabelText(/password/i), password)
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    return user
  }

  it('renders username and password fields with a submit button', () => {
    render(<LoginPage />)

    expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('shows local dev auth bootstrap guidance on the dev workspace login page', () => {
    render(<LoginPage />)

    expect(screen.getByText(/bun run auth:bootstrap-demo/i)).toBeInTheDocument()
    expect(screen.getByText(/demo-admin/i)).toBeInTheDocument()
    expect(screen.getByText(/AUTH_BOOTSTRAP_PASSWORD/i)).toBeInTheDocument()
  })

  it('submits credentials and navigates to default path on success', async () => {
    mockLogin.mockResolvedValueOnce(loginResult('dev', 'user'))
    await submitLogin('admin', 'secret')

    expect(mockLogin).toHaveBeenCalledWith('admin', 'secret')
    expect(mockNavigate).toHaveBeenCalledWith('/dev/resumes', { replace: true })
  })

  it('routes a dev admin login to its workspace resumes desk by default', async () => {
    mockLogin.mockResolvedValueOnce(loginResult('dev', 'admin'))
    await submitLogin('demo-admin', 'demo-admin')

    expect(mockNavigate).toHaveBeenCalledWith('/dev/resumes', { replace: true })
  })

  it('routes an hr member login to /hr/resumes by default', async () => {
    mockLogin.mockResolvedValueOnce(loginResult('hr', 'user'))
    await submitLogin('hr-demo', 'secret')

    expect(mockNavigate).toHaveBeenCalledWith('/hr/resumes', { replace: true })
  })

  it('navigates to redirectTo path on success', async () => {
    mockSearchParams.set('redirectTo', '/dev/settings')
    mockLogin.mockResolvedValueOnce(loginResult('dev', 'admin'))
    await submitLogin('admin', 'secret')

    expect(mockNavigate).toHaveBeenCalledWith('/dev/settings', { replace: true })
  })

  it('preserves an explicit system redirect only for dev admins', async () => {
    mockSearchParams.set('redirectTo', '/admin/system/settings/auth')
    mockLogin.mockResolvedValueOnce(loginResult('dev', 'admin'))
    await submitLogin('demo-admin', 'demo-admin')

    expect(mockNavigate).toHaveBeenCalledWith('/admin/system/settings/auth', { replace: true })
  })

  it('ignores an explicit system redirect for non-admin users', async () => {
    mockSearchParams.set('redirectTo', '/admin/system/settings/auth')
    mockLogin.mockResolvedValueOnce(loginResult('dev', 'user'))
    await submitLogin('dev-user', 'secret')

    expect(mockNavigate).toHaveBeenCalledWith('/dev/resumes', { replace: true })
  })

  it('ignores redirectTo for a workspace the user is not a member of', async () => {
    mockSearchParams.set('redirectTo', '/dev/resumes?location=Malaysia')
    mockLogin.mockResolvedValueOnce(loginResult('hr', 'user'))
    await submitLogin('hr-demo', 'secret')

    expect(mockNavigate).toHaveBeenCalledWith('/hr/resumes', { replace: true })
  })

  it('shows error message on login failure', async () => {
    mockLogin.mockResolvedValueOnce(null)
    await submitLogin('admin', 'wrong')

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('shows a locked-account message instead of invalid-credentials on 429', async () => {
    mockLogin.mockResolvedValueOnce(null)
    mockLastLoginError.status = 429
    mockLastLoginError.retryAfterSeconds = 644
    await submitLogin('admin', 'admin123')

    expect(screen.getByRole('alert')).toHaveTextContent('locked')
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('keeps the generic message for non-lockout failures', async () => {
    mockLogin.mockResolvedValueOnce(null)
    mockLastLoginError.status = 401
    await submitLogin('admin', 'wrong')

    expect(screen.getByRole('alert')).toHaveTextContent(/invalid username or password/i)
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('disables form fields while submitting', async () => {
    let resolveLogin: (value: ReturnType<typeof loginResult>) => void
    mockLogin.mockImplementationOnce(() => new Promise<ReturnType<typeof loginResult>>((resolve) => { resolveLogin = resolve }))
    await submitLogin('admin', 'secret')

    expect(screen.getByLabelText(/username/i)).toBeDisabled()
    expect(screen.getByLabelText(/password/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled()

    resolveLogin!(loginResult('dev', 'user'))
  })
})
