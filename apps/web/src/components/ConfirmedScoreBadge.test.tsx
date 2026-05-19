import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConfirmedScoreBadge } from '@/components/ConfirmedScoreBadge'

describe('ConfirmedScoreBadge', () => {
  it('renders the badge with confirmed text', () => {
    render(<ConfirmedScoreBadge />)
    expect(screen.getByText(/Confirmed/)).toBeInTheDocument()
  })

  it('has the correct styling classes for a confirmed badge', () => {
    render(<ConfirmedScoreBadge />)
    const badge = screen.getByText(/Confirmed/)
    expect(badge).toHaveClass('border-emerald-200')
    expect(badge).toHaveClass('bg-emerald-50')
    expect(badge).toHaveClass('text-emerald-700')
  })
})
