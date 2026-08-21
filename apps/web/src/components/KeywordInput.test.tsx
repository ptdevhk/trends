import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockIndustryKeywords = vi.hoisted(() => ({
  grouped: {
    custom: [
      { id: 1, keyword: 'React', category: 'custom' },
      { id: 2, keyword: 'TypeScript', category: 'custom' },
    ],
  },
}))

vi.mock('@/hooks/useIndustryKeywords', () => ({
  useIndustryKeywords: () => mockIndustryKeywords,
}))

import { KeywordInput } from '@/components/KeywordInput'

describe('KeywordInput', () => {
  const defaultProps = {
    value: '',
    onChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockIndustryKeywords.grouped.custom = [
      { id: 1, keyword: 'React', category: 'custom' },
      { id: 2, keyword: 'TypeScript', category: 'custom' },
    ]
  })

  it('renders input field', () => {
    render(<KeywordInput {...defaultProps} />)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('sets placeholder text', () => {
    render(<KeywordInput {...defaultProps} placeholder="Enter keywords" />)
    expect(screen.getByPlaceholderText('Enter keywords')).toBeInTheDocument()
  })

  it('sets id on input', () => {
    render(<KeywordInput {...defaultProps} id="kw-input" />)
    expect(screen.getByRole('textbox')).toHaveAttribute('id', 'kw-input')
  })

  it('renders custom keyword chips with toggle button', () => {
    render(<KeywordInput {...defaultProps} />)

    // When value is empty, chips render without input text ambiguity
    expect(screen.getByText('React')).toBeInTheDocument()
    expect(screen.getByText('TypeScript')).toBeInTheDocument()

    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBe(3) // toggle + 2 chips
  })

  it('shows checkmark for active keywords', () => {
    render(<KeywordInput {...defaultProps} value="React" />)
    // Use button role query to avoid input value text collision
    expect(screen.getByRole('button', { name: /✓.*React/ })).toBeInTheDocument()
  })

  it('adds keyword on chip click', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<KeywordInput {...defaultProps} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: /React/ }))
    expect(onChange).toHaveBeenCalled()
  })

  it('calls onChange when typing in input', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<KeywordInput {...defaultProps} onChange={onChange} />)

    const input = screen.getByRole('textbox')
    await user.type(input, 'test')
    expect(onChange).toHaveBeenCalled()
  })

  it('renders without custom keywords and no toggle button', () => {
    mockIndustryKeywords.grouped.custom = []
    render(<KeywordInput {...defaultProps} />)

    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('calls onChange when removing active keyword', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<KeywordInput {...defaultProps} value="React TypeScript" onChange={onChange} />)

    // Chip button accessible name contains the keyword text
    await user.click(screen.getByRole('button', { name: /React/ }))
    expect(onChange).toHaveBeenCalled()
  })

  it('has aria-expanded on the toggle button', async () => {
    const user = userEvent.setup()
    render(<KeywordInput {...defaultProps} />)
    const toggle = screen.getByRole('button', { name: /toggle/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })
})
