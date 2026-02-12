import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

// Component that throws an error conditionally
const ThrowError = ({ shouldThrow = true, message = 'Test Error' }) => {
    if (shouldThrow) {
        throw new Error(message)
    }
    return <div>Safe Content</div>
}

describe('ErrorBoundary', () => {
    it('renders children when no error occurs', () => {
        render(
            <ErrorBoundary>
                <div>Safe Content</div>
            </ErrorBoundary>
        )

        expect(screen.getByText('Safe Content')).toBeInTheDocument()
    })

    it('renders fallback UI when an error is caught', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => { })

        render(
            <ErrorBoundary>
                <ThrowError />
            </ErrorBoundary>
        )

        expect(screen.getByText('Something went wrong')).toBeInTheDocument()
        expect(screen.getByText('Test Error')).toBeInTheDocument()

        spy.mockRestore()
    })

    it('resets error state when "Try Again" is clicked', async () => {
        const user = userEvent.setup()
        const spy = vi.spyOn(console, 'error').mockImplementation(() => { })

        const { rerender } = render(
            <ErrorBoundary>
                <ThrowError shouldThrow={true} />
            </ErrorBoundary>
        )

        expect(screen.getByText('Something went wrong')).toBeInTheDocument()

        // Rerender with children that won't throw anymore
        rerender(
            <ErrorBoundary>
                <ThrowError shouldThrow={false} />
            </ErrorBoundary>
        )

        // Click Try Again - this should clear hasError and try to render children again
        await user.click(screen.getByRole('button', { name: /try again/i }))

        await waitFor(() => {
            expect(screen.getByText('Safe Content')).toBeInTheDocument()
        })
        expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()

        spy.mockRestore()
    })
})
