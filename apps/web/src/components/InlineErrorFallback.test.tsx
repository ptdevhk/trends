import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { InlineErrorFallback } from '@/components/InlineErrorFallback'

describe('InlineErrorFallback', () => {
  it('renders the error message', () => {
    render(<InlineErrorFallback message="Something went wrong" />)
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('does not render retry button when onRetry is not provided', () => {
    render(<InlineErrorFallback message="Error" retryLabel="Try again" />)
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('does not render retry button when retryLabel is not provided', () => {
    const onRetry = vi.fn()
    render(<InlineErrorFallback message="Error" onRetry={onRetry} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders retry button when both onRetry and retryLabel are provided', () => {
    const onRetry = vi.fn()
    render(<InlineErrorFallback message="Error" retryLabel="Try again" onRetry={onRetry} />)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('calls onRetry when retry button is clicked', async () => {
    const onRetry = vi.fn()
    const user = userEvent.setup()
    render(<InlineErrorFallback message="Error" retryLabel="Try again" onRetry={onRetry} />)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
