import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StarRating } from '@/components/StarRating'

describe('StarRating', () => {
  it('renders 5 star buttons', () => {
    render(<StarRating />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(5)
  })

  it('renders with correct aria-labels', () => {
    render(<StarRating />)
    expect(screen.getByRole('button', { name: '1 star' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2 stars' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '5 stars' })).toBeInTheDocument()
  })

  it('renders with group role and label', () => {
    render(<StarRating />)
    expect(screen.getByRole('group', { name: 'User rating' })).toBeInTheDocument()
  })

  it('calls onChange with rating when a star is clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<StarRating onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: '3 stars' }))
    expect(onChange).toHaveBeenCalledWith(3)
  })

  it('calls onChange with 0 when the current value star is clicked (toggle off)', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<StarRating value={3} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: '3 stars' }))
    expect(onChange).toHaveBeenCalledWith(0)
  })

  it('does not throw when onChange is not provided', async () => {
    const user = userEvent.setup()
    render(<StarRating value={2} />)
    await user.click(screen.getByRole('button', { name: '4 stars' }))
  })
})
