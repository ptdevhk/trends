import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockIndustryKeywords = vi.hoisted(() => ({
  grouped: {
    location: [
      { id: 1, keyword: 'Shanghai', category: 'location' },
      { id: 2, keyword: 'Beijing', category: 'location' },
    ],
  },
}))

vi.mock('@/hooks/useIndustryKeywords', () => ({
  useIndustryKeywords: () => mockIndustryKeywords,
}))

import { LocationSelector } from '@/components/LocationSelector'

describe('LocationSelector', () => {
  const defaultProps = {
    value: '',
    onChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockIndustryKeywords.grouped.location = [
      { id: 1, keyword: 'Shanghai', category: 'location' },
      { id: 2, keyword: 'Beijing', category: 'location' },
    ]
  })

  it('renders input field', () => {
    render(<LocationSelector {...defaultProps} />)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('sets placeholder text', () => {
    render(<LocationSelector {...defaultProps} placeholder="Enter locations" />)
    expect(screen.getByPlaceholderText('Enter locations')).toBeInTheDocument()
  })

  it('sets id on input', () => {
    render(<LocationSelector {...defaultProps} id="loc-input" />)
    expect(screen.getByRole('textbox')).toHaveAttribute('id', 'loc-input')
  })

  it('renders location chips with toggle', () => {
    render(<LocationSelector {...defaultProps} />)
    expect(screen.getByText('Shanghai')).toBeInTheDocument()
    expect(screen.getByText('Beijing')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBe(3) // toggle + 2 chips
  })

  it('toggles aria-expanded on the expand button', async () => {
    const user = userEvent.setup()
    render(<LocationSelector {...defaultProps} />)
    const toggle = screen.getByRole('button', { name: 'Show location keywords' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAttribute('aria-controls', 'location-keywords-tray')

    await user.click(toggle)
    expect(screen.getByRole('button', { name: 'Hide location keywords' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('sets aria-pressed on location chips', () => {
    render(<LocationSelector {...defaultProps} value="Shanghai" />)
    expect(screen.getByRole('button', { name: /Shanghai/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Beijing/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('highlights active location chip', () => {
    render(<LocationSelector {...defaultProps} value="Shanghai" />)
    const shanghaiChip = screen.getByRole('button', { name: /Shanghai/ })
    expect(shanghaiChip.className).toContain('bg-green-600')
  })

  it('adds location on chip click', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<LocationSelector {...defaultProps} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: /Shanghai/ }))
    expect(onChange).toHaveBeenCalled()
  })

  it('removes active location on chip click', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<LocationSelector {...defaultProps} value="Shanghai" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: /Shanghai/ }))
    expect(onChange).toHaveBeenCalled()
  })

  it('calls onChange when typing in input', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<LocationSelector {...defaultProps} onChange={onChange} />)

    await user.type(screen.getByRole('textbox'), 'Shenzhen')
    expect(onChange).toHaveBeenCalled()
  })

  it('renders without location chips when none available', () => {
    mockIndustryKeywords.grouped.location = []
    render(<LocationSelector {...defaultProps} />)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
