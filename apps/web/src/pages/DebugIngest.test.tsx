import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DebugIngest from './DebugIngest'

const resetMutation = vi.fn(async () => ({ count: 0, cleared: 0 }))

vi.mock('convex/react', () => ({
  useQuery: () => undefined,
  useAction: () => vi.fn(async () => ({ scheduled: 0 })),
  useMutation: () => resetMutation,
}))

vi.mock('@/hooks/useConvexResumes', () => ({
  useConvexResumes: () => ({
    resumes: [],
    loading: false,
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: string | { defaultValue?: string; [key: string]: unknown }) => {
      if (typeof options === 'string') {
        return options
      }
      return options?.defaultValue ?? _key
    },
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('DebugIngest reset database dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: true, version: 1 }),
      }))
    )
  })

  it('opens in-app confirmation dialog instead of native confirm', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm')
    render(<DebugIngest />)

    await user.click(screen.getByRole('button', { name: 'Clear Resume Database' }))

    expect(
      screen.getByText('Delete all resume data and task records? This cannot be undone.')
    ).toBeInTheDocument()
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('closes dialog on cancel and successful reset', async () => {
    const user = userEvent.setup()
    render(<DebugIngest />)

    await user.click(screen.getByRole('button', { name: 'Clear Resume Database' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(
        screen.queryByText('Delete all resume data and task records? This cannot be undone.')
      ).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Clear Resume Database' }))
    const confirmButtons = screen.getAllByRole('button', { name: 'Clear Resume Database' })
    const dialogConfirmButton = confirmButtons[confirmButtons.length - 1]
    if (!dialogConfirmButton) {
      throw new Error('Expected confirmation button in dialog')
    }
    await user.click(dialogConfirmButton)

    await waitFor(() => {
      expect(resetMutation).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(
        screen.queryByText('Delete all resume data and task records? This cannot be undone.')
      ).not.toBeInTheDocument()
    })
  })
})
