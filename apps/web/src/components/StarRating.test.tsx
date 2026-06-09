import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { StarRating } from '@/components/StarRating'

describe('StarRating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders 5 star buttons', () => {
    render(<StarRating />)
    expect(screen.getAllByRole('button')).toHaveLength(5)
  })

  it('renders with correct aria-labels for all stars', () => {
    render(<StarRating />)
    expect(screen.getByRole('button', { name: '1 star' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2 stars' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '3 stars' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '4 stars' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '5 stars' })).toBeInTheDocument()
  })

  it('renders with group role and label', () => {
    render(<StarRating />)
    expect(screen.getByRole('group', { name: 'User rating' })).toBeInTheDocument()
  })

  it('calls onChange with rating when a star is clicked', async () => {
    const onChange = vi.fn()
    render(<StarRating onChange={onChange} />)
    await userEvent.setup().click(screen.getByRole('button', { name: '3 stars' }))
    expect(onChange).toHaveBeenCalledWith(3)
  })

  it('calls onChange with 0 when the current value star is clicked (toggle off)', async () => {
    const onChange = vi.fn()
    render(<StarRating value={3} onChange={onChange} />)
    await userEvent.setup().click(screen.getByRole('button', { name: '3 stars' }))
    expect(onChange).toHaveBeenCalledWith(0)
  })

  it('does not throw when onChange is not provided', async () => {
    render(<StarRating value={2} />)
    await userEvent.setup().click(screen.getByRole('button', { name: '4 stars' }))
  })

  it('disables star buttons when disabled and does not call onChange', async () => {
    const onChange = vi.fn()
    render(<StarRating value={2} onChange={onChange} disabled />)

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(5)
    buttons.forEach((button) => {
      expect(button).toBeDisabled()
    })

    await userEvent.setup().click(screen.getByRole('button', { name: '4 stars' }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('treats missing onChange as read-only', () => {
    render(<StarRating value={2} />)

    screen.getAllByRole('button').forEach((button) => {
      expect(button).toBeDisabled()
    })
  })

  it('applies filled class to stars up to the value', () => {
    render(<StarRating value={3} />)
    const buttons = screen.getAllByRole('button')
    const filledStars = buttons.filter(btn => btn.querySelector('.fill-amber-400'))
    expect(filledStars).toHaveLength(3)
  })

  it('applies unfilled class to stars above the value', () => {
    render(<StarRating value={2} />)
    const buttons = screen.getAllByRole('button')
    const unfilledStars = buttons.filter(btn => btn.querySelector('.text-slate-300'))
    expect(unfilledStars).toHaveLength(3)
  })
})
