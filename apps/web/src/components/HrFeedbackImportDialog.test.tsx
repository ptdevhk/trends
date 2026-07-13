import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HrFeedbackImportDialog } from './HrFeedbackImportDialog'

const { apiPostMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  apiPostMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    POST: apiPostMock,
  },
}))

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}))

const feedbackRow = 'resume-1\tAlice\tStrong machine-tool sales experience'

function successResponse() {
  return {
    data: {
      success: true,
      total: 1,
      imported: 1,
      skipped: 0,
      notFound: [],
      results: [
        {
          resumeId: 'resume-1',
          name: 'Alice',
          comments: 'Strong machine-tool sales experience',
          status: 'imported',
        },
      ],
    },
  }
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Import HR feedback' }))
  return screen.findByRole('dialog')
}

async function enterAndParse(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await openDialog(user)
  await user.type(within(dialog).getByRole('textbox'), feedbackRow)
  await user.click(within(dialog).getByRole('button', { name: 'Parse' }))
  return dialog
}

describe('HrFeedbackImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clears raw text, parsed rows, and results after close and reopen', async () => {
    const user = userEvent.setup()
    apiPostMock.mockResolvedValueOnce(successResponse())
    render(<HrFeedbackImportDialog />)

    const dialog = await enterAndParse(user)
    await user.click(within(dialog).getByRole('button', { name: 'Confirm import' }))
    await waitFor(() => expect(apiPostMock).toHaveBeenCalledTimes(1))
    expect(within(dialog).getByText('imported')).toBeInTheDocument()

    const closeButtons = within(dialog).getAllByRole('button', { name: 'Close' })
    await user.click(closeButtons[closeButtons.length - 1] as HTMLButtonElement)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const reopened = await openDialog(user)
    expect(within(reopened).getByRole('textbox')).toHaveValue('')
    expect(within(reopened).getByRole('button', { name: 'Confirm import' })).toBeDisabled()
    expect(within(reopened).queryByText('resume-1')).not.toBeInTheDocument()
    expect(within(reopened).queryByText('imported')).not.toBeInTheDocument()
  })

  it('invalidates parsed rows and prior results when raw text changes', async () => {
    const user = userEvent.setup()
    render(<HrFeedbackImportDialog />)

    const dialog = await enterAndParse(user)
    expect(within(dialog).getByRole('button', { name: 'Confirm import' })).toBeEnabled()
    expect(within(dialog).getByText('resume-1')).toBeInTheDocument()

    await user.type(within(dialog).getByRole('textbox'), '\nresume-2\tBob\tNew feedback')

    expect(within(dialog).getByRole('button', { name: 'Confirm import' })).toBeDisabled()
    expect(within(dialog).queryByText('resume-1')).not.toBeInTheDocument()
  })

  it('locks successful input until the user edits and reparses it', async () => {
    const user = userEvent.setup()
    apiPostMock.mockResolvedValue(successResponse())
    render(<HrFeedbackImportDialog />)

    const dialog = await enterAndParse(user)
    const confirm = within(dialog).getByRole('button', { name: 'Confirm import' })
    await user.click(confirm)

    await waitFor(() => expect(apiPostMock).toHaveBeenCalledTimes(1))
    expect(confirm).toBeDisabled()
    await user.click(confirm)
    expect(apiPostMock).toHaveBeenCalledTimes(1)

    await user.type(within(dialog).getByRole('textbox'), '\nresume-2\tBob\tFresh feedback')
    expect(confirm).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'Parse' }))
    expect(confirm).toBeEnabled()
  })

  it('allows only one request while an import is pending', async () => {
    let resolveRequest: ((value: ReturnType<typeof successResponse>) => void) | undefined
    apiPostMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRequest = resolve
    }))
    const user = userEvent.setup()
    render(<HrFeedbackImportDialog />)

    const dialog = await enterAndParse(user)
    const confirm = within(dialog).getByRole('button', { name: 'Confirm import' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    expect(apiPostMock).toHaveBeenCalledTimes(1)
    expect(confirm).toBeDisabled()

    resolveRequest?.(successResponse())
    await waitFor(() => expect(within(dialog).getByText('imported')).toBeInTheDocument())
  })
})
