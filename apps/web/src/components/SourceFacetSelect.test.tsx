import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { SourceFacetSelect, type SourceFacet } from '@/components/SourceFacetSelect'

describe('SourceFacetSelect', () => {
  const defaultProps = {
    id: 'source-facet',
    facets: [] as SourceFacet[],
    value: [] as string[],
    onChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders label and select element', () => {
    render(<SourceFacetSelect {...defaultProps} />)
    expect(screen.getByLabelText('Source Filter')).toBeInTheDocument()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('renders facet options with counts', () => {
    const facets: SourceFacet[] = [
      { key: '51job', label: '51job', count: 100 },
      { key: 'linkedin', label: 'LinkedIn', count: 50 },
    ]
    render(<SourceFacetSelect {...defaultProps} facets={facets} />)

    expect(screen.getByText('51job (100)')).toBeInTheDocument()
    expect(screen.getByText('LinkedIn (50)')).toBeInTheDocument()
  })

  it('handles undefined facets gracefully', () => {
    render(<SourceFacetSelect {...defaultProps} facets={undefined} />)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('handles empty facets array', () => {
    render(<SourceFacetSelect {...defaultProps} facets={[]} />)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('calls onChange when selection changes', async () => {
    const onChange = vi.fn()
    const facets: SourceFacet[] = [
      { key: '51job', label: '51job', count: 100 },
    ]
    const user = userEvent.setup()
    render(
      <SourceFacetSelect
        {...defaultProps}
        facets={facets}
        onChange={onChange}
      />
    )

    const select = screen.getByRole('listbox')
    await user.selectOptions(select, '51job')
    expect(onChange).toHaveBeenCalledWith(['51job'])
  })
})
