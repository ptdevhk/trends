import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FacetBadge } from '@/components/search/FacetBadge'

describe('FacetBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without a count badge when there are no active filters', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()

    render(<FacetBadge activeCount={0} onClick={onClick} />)

    const button = screen.getByRole('button', { name: 'Filters' })
    expect(button).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()

    await user.click(button)

    expect(onClick).toHaveBeenCalled()
  })

  it('renders the active-count badge and floating style when requested', () => {
    render(<FacetBadge activeCount={3} floating onClick={vi.fn()} />)

    const button = screen.getByRole('button', { name: /Filters\s*3/i })
    expect(button).toHaveClass('shadow-lg')
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})
