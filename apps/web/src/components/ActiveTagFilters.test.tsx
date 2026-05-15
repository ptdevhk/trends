import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ActiveTagFilters } from '@/components/ActiveTagFilters'

describe('ActiveTagFilters', () => {
  const defaultProps = {
    selectedTags: [] as string[],
    selectedCompanies: [] as string[],
    selectedBrands: [] as string[],
    selectedExperienceLevel: undefined,
    onRemoveTag: vi.fn(),
    onRemoveCompany: vi.fn(),
    onRemoveBrand: vi.fn(),
    onRemoveExperienceLevel: vi.fn(),
    onClearAll: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when no filters are active', () => {
    const { container } = render(<ActiveTagFilters {...defaultProps} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders tag chips and calls onRemoveTag', async () => {
    const onRemoveTag = vi.fn()
    const user = userEvent.setup()
    render(
      <ActiveTagFilters
        {...defaultProps}
        selectedTags={['React', 'TypeScript']}
        onRemoveTag={onRemoveTag}
      />
    )

    expect(screen.getByText('React')).toBeInTheDocument()
    expect(screen.getByText('TypeScript')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'React' }))
    expect(onRemoveTag).toHaveBeenCalledWith('React')
  })

  it('renders company chips in uppercase', () => {
    render(
      <ActiveTagFilters
        {...defaultProps}
        selectedCompanies={['google', 'meta']}
      />
    )
    expect(screen.getByText('GOOGLE')).toBeInTheDocument()
    expect(screen.getByText('META')).toBeInTheDocument()
  })

  it('renders brand chips', () => {
    render(
      <ActiveTagFilters
        {...defaultProps}
        selectedBrands={['Apple']}
      />
    )
    expect(screen.getByText('Apple')).toBeInTheDocument()
  })

  it('renders experience level filters with correct labels', () => {
    const { rerender } = render(
      <ActiveTagFilters
        {...defaultProps}
        selectedExperienceLevel={'senior' as const}
      />
    )
    expect(screen.getByText('资深')).toBeInTheDocument()

    rerender(
      <ActiveTagFilters
        {...defaultProps}
        selectedExperienceLevel={'mid' as const}
      />
    )
    expect(screen.getByText('中级')).toBeInTheDocument()

    rerender(
      <ActiveTagFilters
        {...defaultProps}
        selectedExperienceLevel={'junior' as const}
      />
    )
    expect(screen.getByText('初级')).toBeInTheDocument()
  })

  it('renders location chip when provided', () => {
    const onRemoveLocation = vi.fn()
    render(
      <ActiveTagFilters
        {...defaultProps}
        selectedLocation="Shanghai"
        onRemoveLocation={onRemoveLocation}
      />
    )
    expect(screen.getByText(/Shanghai/)).toBeInTheDocument()
  })

  it('calls onClearAll when Clear All is clicked', async () => {
    const onClearAll = vi.fn()
    const user = userEvent.setup()
    render(
      <ActiveTagFilters
        {...defaultProps}
        selectedTags={['React']}
        onClearAll={onClearAll}
      />
    )
    await user.click(screen.getByText('Clear All'))
    expect(onClearAll).toHaveBeenCalled()
  })

  it('handles location removal callback', async () => {
    const onRemoveLocation = vi.fn()
    const user = userEvent.setup()
    render(
      <ActiveTagFilters
        {...defaultProps}
        selectedLocation="Beijing"
        onRemoveLocation={onRemoveLocation}
      />
    )
    await user.click(screen.getByRole('button', { name: /Beijing/ }))
    expect(onRemoveLocation).toHaveBeenCalled()
  })
})
