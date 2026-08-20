import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { JobDescriptionEditor } from './JobDescriptionEditor'

const createJDMock = vi.hoisted(() => vi.fn())
const updateJDMock = vi.hoisted(() => vi.fn())
const toastErrorMock = vi.hoisted(() => vi.fn())

vi.mock('sonner', () => ({
  toast: { error: toastErrorMock, success: vi.fn() },
}))

vi.mock('convex/react', () => ({
  useMutation: (ref: string) => {
    // The component passes api.job_descriptions.create and api.job_descriptions.update
    // which are just strings in our mock
    if (ref === 'jds:create') return createJDMock
    if (ref === 'jds:update') return updateJDMock
    return vi.fn()
  },
}))

vi.mock('../../../../packages/convex/convex/_generated/api', () => ({
  api: { job_descriptions: { create: 'jds:create', update: 'jds:update' } },
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children, onOpenChange }: { open: boolean; children: React.ReactNode; onOpenChange: (open: boolean) => void }) =>
    open ? <div data-testid="dialog">{children}<button data-testid="dialog-backdrop" onClick={() => onOpenChange(false)} /></div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

const mockT = (_key: string, opts?: string | { defaultValue?: string }) =>
  typeof opts === 'string' ? opts : (opts?.defaultValue ?? _key);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'dev' }),
}))

vi.mock('@/components/LocationSelector', () => ({
  LocationSelector: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input data-testid="location" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

vi.mock('@/components/KeywordInput', () => ({
  KeywordInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input data-testid="keywords" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

describe('JobDescriptionEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createJDMock.mockResolvedValue('new-jd-id')
    updateJDMock.mockResolvedValue(undefined)
  })

  it('renders create dialog when open with no initialData', () => {
    render(<JobDescriptionEditor open={true} onOpenChange={() => {}} />)

    expect(screen.getByText('Create Custom Job Description')).toBeInTheDocument()
  })

  it('renders edit dialog when initialData has type=custom', () => {
    render(
      <JobDescriptionEditor
        open={true}
        onOpenChange={() => {}}
        initialData={{ id: 'jd-1' as never, title: 'My JD', content: 'c', type: 'custom' }}
      />,
    )

    expect(screen.getByText('Edit Job Description')).toBeInTheDocument()
  })

  it('populates fields from initialData', () => {
    render(
      <JobDescriptionEditor
        open={true}
        onOpenChange={() => {}}
        initialData={{
          title: 'CNC Sales',
          content: 'Job desc',
          type: 'system',
          location: 'Dongguan',
          industryTags: ['CNC'],
          customKeywords: ['lathe'],
          minExperience: 3,
        }}
      />,
    )

    expect(screen.getByLabelText('Job Title')).toHaveValue('CNC Sales (Custom Copy)')
    expect(screen.getByTestId('location')).toHaveValue('Dongguan')
    expect(screen.getByTestId('keywords')).toHaveValue('lathe')
  })

  it('resets fields when dialog opens fresh', async () => {
    const { rerender } = render(
      <JobDescriptionEditor open={true} onOpenChange={() => {}} />,
    )

    const titleInput = screen.getByLabelText('Job Title')
    await userEvent.type(titleInput, 'Test Title')

    // Close and reopen
    rerender(<JobDescriptionEditor open={false} onOpenChange={() => {}} />)
    rerender(<JobDescriptionEditor open={true} onOpenChange={() => {}} />)

    expect(screen.getByLabelText('Job Title')).toHaveValue('')
  })

  it('calls createJD on save for new JDs', async () => {
    const onOpenChange = vi.fn()
    const onSaveSuccess = vi.fn()

    render(
      <JobDescriptionEditor
        open={true}
        onOpenChange={onOpenChange}
        onSaveSuccess={onSaveSuccess}
      />,
    )

    await userEvent.type(screen.getByLabelText('Job Title'), 'Senior Engineer')
    await userEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(createJDMock).toHaveBeenCalled()
    })

    const callArgs = createJDMock.mock.calls[0][0]
    expect(callArgs.title).toBe('Senior Engineer')
    expect(callArgs.type).toBe('custom')
    expect(callArgs.workspaceSlug).toBe('dev')
  })

  it('calls updateJD on save when editing existing custom JD', async () => {
    const onSaveSuccess = vi.fn()

    render(
      <JobDescriptionEditor
        open={true}
        onOpenChange={() => {}}
        onSaveSuccess={onSaveSuccess}
        initialData={{
          id: 'jd-existing' as never,
          title: 'Existing JD',
          content: 'content',
          type: 'custom',
        }}
      />,
    )

    // Clear and type a new title
    const titleInput = screen.getByLabelText('Job Title')
    await userEvent.clear(titleInput)
    await userEvent.type(titleInput, 'Updated JD')
    await userEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(updateJDMock).toHaveBeenCalled()
    })

    const callArgs = updateJDMock.mock.calls[0][0]
    expect(callArgs.id).toBe('jd-existing')
    expect(callArgs.title).toBe('Updated JD')
  })

  it('does not save when title is empty and shows inline error', async () => {
    render(<JobDescriptionEditor open={true} onOpenChange={() => {}} />)

    await userEvent.click(screen.getByText('Save'))

    expect(createJDMock).not.toHaveBeenCalled()
    expect(updateJDMock).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent('Job title is required')
    expect(screen.getByLabelText('Job Title')).toHaveAttribute('aria-invalid', 'true')
  })

  it('calls onOpenChange(false) after successful save', async () => {
    const onOpenChange = vi.fn()

    render(
      <JobDescriptionEditor
        open={true}
        onOpenChange={onOpenChange}
      />,
    )

    await userEvent.type(screen.getByLabelText('Job Title'), 'My Role')
    await userEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('calls onSaveSuccess with saved fields after creation', async () => {
    const onSaveSuccess = vi.fn()

    render(
      <JobDescriptionEditor
        open={true}
        onOpenChange={() => {}}
        onSaveSuccess={onSaveSuccess}
      />,
    )

    await userEvent.type(screen.getByLabelText('Job Title'), 'CNC Operator')
    await userEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(onSaveSuccess).toHaveBeenCalled()
    })

    const savedArgs = onSaveSuccess.mock.calls[0]
    expect(savedArgs[0]).toBe('new-jd-id')
    expect(savedArgs[1].title).toBe('CNC Operator')
  })

  it('shows saving state while saving', async () => {
    let resolveSave!: () => void
    createJDMock.mockReturnValue(new Promise<void>((resolve) => { resolveSave = resolve }))

    render(<JobDescriptionEditor open={true} onOpenChange={() => {}} />)

    await userEvent.type(screen.getByLabelText('Job Title'), 'Test')
    await userEvent.click(screen.getByText('Save'))

    expect(screen.getByText('Saving...')).toBeInTheDocument()

    resolveSave!()
    await waitFor(() => {
      expect(screen.queryByText('Saving...')).not.toBeInTheDocument()
    })
  })

  it('handles save error gracefully', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    createJDMock.mockRejectedValue(new Error('Network error'))

    render(<JobDescriptionEditor open={true} onOpenChange={() => {}} />)

    await userEvent.type(screen.getByLabelText('Job Title'), 'Test')
    await userEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to save JD', expect.any(Error))
    })
    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Network error')
    })

    consoleErrorSpy.mockRestore()
  })

  it('saves on form submit (Enter-to-save path)', async () => {
    render(<JobDescriptionEditor open={true} onOpenChange={() => {}} />)

    await userEvent.type(screen.getByLabelText('Job Title'), 'Enter Saved Role')
    const form = screen.getByTestId('dialog').querySelector('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form!)

    await waitFor(() => {
      expect(createJDMock).toHaveBeenCalled()
    })
    expect(createJDMock.mock.calls[0][0].title).toBe('Enter Saved Role')
  })

  it('blocks form submission while IME composition is in flight', async () => {
    render(<JobDescriptionEditor open={true} onOpenChange={() => {}} />)

    const titleInput = screen.getByLabelText('Job Title')
    const keyDownEvent = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true })
    const preventDefaultSpy = vi.spyOn(keyDownEvent, 'preventDefault')
    fireEvent(titleInput, keyDownEvent)

    expect(preventDefaultSpy).toHaveBeenCalled()
    expect(createJDMock).not.toHaveBeenCalled()
  })

  it('closes dialog via onOpenChange when clicking cancel', async () => {
    const onOpenChange = vi.fn()

    render(
      <JobDescriptionEditor
        open={true}
        onOpenChange={onOpenChange}
      />,
    )

    await userEvent.click(screen.getByText('Cancel'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
