import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { BulkActionBar } from './BulkActionBar'

describe('BulkActionBar', () => {
    const onSelectAll = vi.fn()
    const onSelectHighScore = vi.fn()
    const onClearSelection = vi.fn()
    const onBulkAction = vi.fn()

    const defaultProps = {
        totalCount: 100,
        selectedCount: 5,
        highScoreCount: 10,
        onSelectAll,
        onSelectHighScore,
        onClearSelection,
        onBulkAction,
    }

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders selection and high score counts', () => {
        render(<MemoryRouter><BulkActionBar {...defaultProps} /></MemoryRouter>)
        expect(screen.getByText('5 / 100')).toBeInTheDocument()
        // Use regex to find text that might be split by elements/newlines in DOM
        expect(screen.getByText(/\(10\)/)).toBeInTheDocument()
    })

    it('marks the total count as a lower bound when more result pages exist', () => {
        render(
            <MemoryRouter>
                <BulkActionBar {...defaultProps} totalCountIsLowerBound />
            </MemoryRouter>,
        )

        expect(screen.getByText('5 / 100+')).toBeInTheDocument()
    })

    it('triggers selection callbacks', async () => {
        const user = userEvent.setup()
        render(<MemoryRouter><BulkActionBar {...defaultProps} /></MemoryRouter>)

        await user.click(screen.getByText('全选'))
        expect(onSelectAll).toHaveBeenCalledTimes(1)

        await user.click(screen.getByText('取消选择'))
        expect(onClearSelection).toHaveBeenCalledTimes(1)
    })

    it('triggers bulk actions sequentially', async () => {
        const user = userEvent.setup()
        onBulkAction.mockResolvedValue(undefined)
        render(<MemoryRouter><BulkActionBar {...defaultProps} /></MemoryRouter>)

        await user.click(screen.getByText('批量入围'))
        expect(onBulkAction).toHaveBeenCalledWith('shortlist')

        await user.click(screen.getByText('批量拒绝'))
        expect(onBulkAction).toHaveBeenCalledWith('reject')
    })

    it('disables bulk action buttons when nothing is selected', () => {
        render(<MemoryRouter><BulkActionBar {...defaultProps} selectedCount={0} /></MemoryRouter>)
        expect(screen.getByText('批量入围').closest('button')).toBeDisabled()
        expect(screen.getByText('批量拒绝').closest('button')).toBeDisabled()
        expect(screen.queryByText('取消选择')).not.toBeInTheDocument()
    })
})
