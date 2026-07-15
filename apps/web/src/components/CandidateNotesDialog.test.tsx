import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CandidateNotesDialog } from '@/components/CandidateNotesDialog'

describe('CandidateNotesDialog', () => {
  it('opens in compose mode when notes are empty', () => {
    render(
      <CandidateNotesDialog
        open
        onOpenChange={vi.fn()}
        candidateName="陈先生"
        notes=""
        onSave={vi.fn()}
      />,
    )
    expect(screen.getByTestId('candidate-notes-input')).toBeInTheDocument()
    expect(screen.getByTestId('candidate-notes-save')).toBeInTheDocument()
  })

  it('opens in view mode when notes exist and requires Edit before save', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <CandidateNotesDialog
        open
        onOpenChange={vi.fn()}
        candidateName="陈先生"
        notes="imported hr note"
        onSave={onSave}
      />,
    )
    expect(screen.getByTestId('candidate-notes-view')).toHaveTextContent('imported hr note')
    expect(screen.queryByTestId('candidate-notes-input')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('candidate-notes-edit'))
    const input = screen.getByTestId('candidate-notes-input')
    await user.clear(input)
    await user.type(input, 'revised note')
    await user.click(screen.getByTestId('candidate-notes-save'))
    expect(onSave).toHaveBeenCalledWith('revised note')
  })

  it('does not call onSave when draft is empty', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <CandidateNotesDialog
        open
        onOpenChange={onOpenChange}
        candidateName="陈先生"
        notes=""
        onSave={onSave}
      />,
    )
    await user.click(screen.getByTestId('candidate-notes-save'))
    expect(onSave).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
