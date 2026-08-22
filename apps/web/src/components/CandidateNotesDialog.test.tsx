import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
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

  it('shows the shortcut hint in edit mode', () => {
    render(
      <CandidateNotesDialog
        open
        onOpenChange={vi.fn()}
        candidateName="Test"
        notes=""
        onSave={vi.fn()}
      />,
    )
    expect(screen.getByTestId('candidate-notes-shortcut-hint')).toBeInTheDocument()
  })

  it('plain Enter inserts newline and does not save', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <CandidateNotesDialog
        open
        onOpenChange={vi.fn()}
        candidateName="Test"
        notes=""
        onSave={onSave}
      />,
    )
    const input = screen.getByTestId('candidate-notes-input')
    await user.type(input, 'line1{Enter}line2')
    expect(onSave).not.toHaveBeenCalled()
    expect(input).toHaveValue('line1\nline2')
  })

  it('Ctrl+Enter saves the draft', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <CandidateNotesDialog
        open
        onOpenChange={vi.fn()}
        candidateName="Test"
        notes=""
        onSave={onSave}
      />,
    )
    const input = screen.getByTestId('candidate-notes-input')
    await user.type(input, 'my note')
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(onSave).toHaveBeenCalledWith('my note')
  })

  it('IME composition Enter does not save', () => {
    const onSave = vi.fn()
    render(
      <CandidateNotesDialog
        open
        onOpenChange={vi.fn()}
        candidateName="Test"
        notes=""
        onSave={onSave}
      />,
    )
    const input = screen.getByTestId('candidate-notes-input')
    const keyDownEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      keyCode: 229,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    })
    fireEvent(input, keyDownEvent)
    expect(onSave).not.toHaveBeenCalled()
  })
})
