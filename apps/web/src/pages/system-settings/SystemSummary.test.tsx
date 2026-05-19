import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockUseQuery = vi.hoisted(() => vi.fn())

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}))

vi.mock('../../../../../packages/convex/convex/_generated/api', () => ({
  api: { resume_tasks: { getSummary: 'resume_tasks:getSummary' } },
}))

import { SystemSummary } from './SystemSummary'

describe('SystemSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when summary query is undefined (loading)', () => {
    mockUseQuery.mockReturnValue(undefined)
    const { container } = render(<SystemSummary />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders summary card with stats from query', () => {
    mockUseQuery.mockReturnValue({
      activeWorkers: 3,
      total: 150,
      processing: 12,
      pending: 25,
      completed: 108,
      failed: 4,
      cancelled: 1,
    })

    render(<SystemSummary />)

    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('150')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('25')).toBeInTheDocument()
    expect(screen.getByText('108')).toBeInTheDocument()
    // failed + cancelled = 5
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('shows active worker count badge', () => {
    mockUseQuery.mockReturnValue({
      activeWorkers: 5,
      total: 0,
      processing: 0,
      pending: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    })

    render(<SystemSummary />)
    expect(screen.getByText('5')).toBeInTheDocument()
  })
})
