import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { BulkActionBar } from './BulkActionBar'
import { CANDIDATE_STATUS_VALUES } from '@/types/resume'

describe('BulkActionBar', () => {
    const onSelectAll = vi.fn()
    const onSelectHighScore = vi.fn()
    const onClearSelection = vi.fn()
    const onBulkAction = vi.fn()
    const onStatusFilterChange = vi.fn()

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

    it('switches to all candidate statuses from the status toolbar', async () => {
        const user = userEvent.setup()
        render(
            <MemoryRouter>
                <BulkActionBar
                    {...defaultProps}
                    onStatusFilterChange={onStatusFilterChange}
                    onStatusToggle={vi.fn()}
                    statusFacetCounts={{ new: 26, shortlisted: 15, rejected: 172, interviewed_pass: 1 }}
                />
            </MemoryRouter>,
        )

        await user.click(screen.getByText('全部状态'))

        expect(onStatusFilterChange).toHaveBeenCalledWith([...CANDIDATE_STATUS_VALUES])
        expect(screen.getByText('214')).toBeInTheDocument()
        expect(screen.getByText('interviewed_pass')).toBeInTheDocument()
    })

    it('places company-policy hide chips on the main selection row', async () => {
        const user = userEvent.setup()
        const onShow = vi.fn()
        render(
            <MemoryRouter>
                <BulkActionBar
                    {...defaultProps}
                    companyPolicyHiddenCount={2}
                    showCompanyPolicyHidden={false}
                    onShowCompanyPolicyHiddenChange={onShow}
                />
            </MemoryRouter>,
        )

        const bar = screen.getByTestId('bulk-action-bar')
        const toggle = screen.getByTestId('company-policy-hidden-toggle')
        expect(bar).toContainElement(toggle)
        // Inline with selection row (no separate footer section)
        expect(bar.querySelector('[class*="border-t"]')).toBeNull()
        expect(screen.getByTestId('company-policy-hidden-count')).toHaveTextContent(/2/)

        await user.click(screen.getByTestId('company-policy-show-hidden'))
        expect(onShow).toHaveBeenCalledWith(true)
    })
})
