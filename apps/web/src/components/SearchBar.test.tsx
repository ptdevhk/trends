import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { SearchBar } from '@/components/SearchBar'

describe('SearchBar', () => {
  const defaultProps = {
    onSearch: vi.fn(),
    onClear: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const getSubmitButton = () => screen.getByRole('button', { name: 'search.button' })

  it('renders search input and button', () => {
    render(<SearchBar {...defaultProps} />)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(getSubmitButton()).toBeInTheDocument()
  })

  it('calls onSearch with trimmed keyword on submit', async () => {
    const onSearch = vi.fn()
    const user = userEvent.setup()
    render(<SearchBar {...defaultProps} onSearch={onSearch} />)

    const input = screen.getByRole('textbox')
    await user.type(input, '  React Developer  ')
    await user.click(getSubmitButton())

    expect(onSearch).toHaveBeenCalledWith('React Developer')
  })

  it('does not call onSearch for empty input', async () => {
    const onSearch = vi.fn()
    const user = userEvent.setup()
    render(<SearchBar {...defaultProps} onSearch={onSearch} />)

    await user.click(getSubmitButton())
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('disables submit button when loading', () => {
    render(<SearchBar {...defaultProps} loading={true} />)
    expect(getSubmitButton()).toBeDisabled()
  })

  it('shows clear button when keyword is entered and clears on click', async () => {
    const onClear = vi.fn()
    const user = userEvent.setup()
    render(<SearchBar {...defaultProps} onClear={onClear} />)

    const input = screen.getByRole('textbox')
    await user.type(input, 'test')
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /clear/i }))
    expect(onClear).toHaveBeenCalled()
    expect(input).toHaveValue('')
  })

  it('uses custom placeholder and button label', () => {
    render(
      <SearchBar
        {...defaultProps}
        placeholder="Custom placeholder"
        buttonLabel="Go"
      />
    )
    expect(screen.getByPlaceholderText('Custom placeholder')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument()
  })

  it('renders without clear button when input is empty', () => {
    render(<SearchBar {...defaultProps} />)
    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument()
  })
})
