import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyState } from './EmptyState'
import { FileText } from 'lucide-react'

describe('EmptyState', () => {
    it('renders title and description', () => {
        render(
            <EmptyState
                title="No items found"
                description="Try adjusting your filters"
            />
        )

        expect(screen.getByText('No items found')).toBeInTheDocument()
        expect(screen.getByText('Try adjusting your filters')).toBeInTheDocument()
    })

    it('renders with an icon if provided', () => {
        const { container } = render(
            <EmptyState
                title="Check icon"
                icon={FileText}
            />
        )

        // Check if lucide icon is rendered (lucide-react icons render as svg)
        const svg = container.querySelector('svg')
        expect(svg).toBeInTheDocument()
        expect(svg).toHaveClass('lucide-file-text')
    })

    it('renders action button if provided', () => {
        render(
            <EmptyState
                title="With Action"
                action={<button>Click Me</button>}
            />
        )

        expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument()
    })
})
