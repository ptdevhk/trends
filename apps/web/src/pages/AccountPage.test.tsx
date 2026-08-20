import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockChangePassword = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

const mockT = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

vi.mock('sonner', () => ({
  toast: mockToast,
}))

vi.mock('@/lib/auth', () => ({
  changePassword: mockChangePassword,
}))

import { AccountPage } from './AccountPage'

describe('AccountPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the password fields with submission disabled initially', () => {
    render(<AccountPage />)

    expect(screen.getByLabelText('Current password')).toBeInTheDocument()
    expect(screen.getByLabelText('New password')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm new password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled()
  })

  it('rejects a seven-character new password using the API eight-character contract', async () => {
    const user = userEvent.setup()
    render(<AccountPage />)

    await user.type(screen.getByLabelText('Current password'), 'old-password')
    await user.type(screen.getByLabelText('New password'), '1234567')
    await user.type(screen.getByLabelText('Confirm new password'), '1234567')

    expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled()
    expect(mockChangePassword).not.toHaveBeenCalled()
  })

  it('submits matching eight-character credentials and clears the form on success', async () => {
    mockChangePassword.mockResolvedValueOnce({ success: true })
    const user = userEvent.setup()
    render(<AccountPage />)

    const currentPassword = screen.getByLabelText('Current password')
    const newPassword = screen.getByLabelText('New password')
    const confirmPassword = screen.getByLabelText('Confirm new password')

    await user.type(currentPassword, 'old-password')
    await user.type(newPassword, '12345678')
    await user.type(confirmPassword, '12345678')
    await user.click(screen.getByRole('button', { name: 'Change password' }))

    await waitFor(() => {
      expect(mockChangePassword).toHaveBeenCalledWith('old-password', '12345678')
    })
    expect(mockToast.success).toHaveBeenCalledWith('Password changed successfully')
    expect(currentPassword).toHaveValue('')
    expect(newPassword).toHaveValue('')
    expect(confirmPassword).toHaveValue('')
  })

  it('shows the field-level error returned for an incorrect current password', async () => {
    mockChangePassword.mockResolvedValueOnce({
      success: false,
      error: 'Current password invalid',
      status: 403,
    })
    const user = userEvent.setup()
    render(<AccountPage />)

    await user.type(screen.getByLabelText('Current password'), 'wrong-password')
    await user.type(screen.getByLabelText('New password'), '12345678')
    await user.type(screen.getByLabelText('Confirm new password'), '12345678')
    await user.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument()
    expect(mockToast.error).not.toHaveBeenCalled()
  })

  it('toggles password visibility with show/hide buttons per field', async () => {
    const user = userEvent.setup()
    render(<AccountPage />)

    const currentPassword = screen.getByLabelText('Current password')
    expect(currentPassword).toHaveAttribute('type', 'password')

    const showButtons = screen.getAllByRole('button', { name: 'Show password' })
    expect(showButtons).toHaveLength(3)

    await user.click(showButtons[0])

    expect(currentPassword).toHaveAttribute('type', 'text')
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('Confirm new password')).toHaveAttribute('type', 'password')
    expect(screen.getAllByRole('button', { name: 'Show password' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Hide password' }))

    expect(currentPassword).toHaveAttribute('type', 'password')
    expect(screen.getAllByRole('button', { name: 'Show password' })).toHaveLength(3)
  })
})
