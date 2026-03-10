import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ExportDialog, type ExportDialogResult } from './ExportDialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOptions?: string | { count?: number; defaultValue?: string }) => {
      if (typeof fallbackOrOptions === 'string') return fallbackOrOptions
      return fallbackOrOptions?.defaultValue ?? _key
    },
  }),
}))

describe('ExportDialog', () => {
  let onConfirm: (result: ExportDialogResult) => void
  let onOpenChange: (open: boolean) => void

  beforeEach(() => {
    onConfirm = vi.fn()
    onOpenChange = vi.fn()
  })

  it('renders with selected count and default format', () => {
    render(
      <ExportDialog
        open={true}
        onOpenChange={onOpenChange}
        selectedCount={5}
        onConfirm={onConfirm}
      />
    )

    expect(screen.getByText('Export Resumes')).toBeInTheDocument()
    expect(screen.getByText(/5 selected resume/)).toBeInTheDocument()
    expect(screen.getByTestId('export-comment')).toBeInTheDocument()
    expect(screen.getByTestId('export-reference')).toBeInTheDocument()
  })

  it('submits with format, comment, and reference note', async () => {
    const user = userEvent.setup()

    render(
      <ExportDialog
        open={true}
        onOpenChange={onOpenChange}
        selectedCount={3}
        defaultFormat="xlsx"
        onConfirm={onConfirm}
      />
    )

    await user.type(screen.getByTestId('export-comment'), 'Test comment')
    await user.type(screen.getByTestId('export-reference'), 'Reference note text')
    await user.click(screen.getByText('Export'))

    expect(onConfirm).toHaveBeenCalledWith({
      format: 'xlsx',
      userComment: 'Test comment',
      referenceNote: 'Reference note text',
    } satisfies ExportDialogResult)
  })

  it('submits empty strings when fields are blank', async () => {
    const user = userEvent.setup()

    render(
      <ExportDialog
        open={true}
        onOpenChange={onOpenChange}
        selectedCount={1}
        onConfirm={onConfirm}
      />
    )

    await user.click(screen.getByText('Export'))

    expect(onConfirm).toHaveBeenCalledWith({
      format: 'csv',
      userComment: '',
      referenceNote: '',
    })
  })

  it('closes on cancel without calling onConfirm', async () => {
    const user = userEvent.setup()

    render(
      <ExportDialog
        open={true}
        onOpenChange={onOpenChange}
        selectedCount={2}
        onConfirm={onConfirm}
      />
    )

    await user.click(screen.getByText('Cancel'))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('does not render when closed', () => {
    render(
      <ExportDialog
        open={false}
        onOpenChange={onOpenChange}
        selectedCount={2}
        onConfirm={onConfirm}
      />
    )

    expect(screen.queryByText('Export Resumes')).not.toBeInTheDocument()
  })
})
