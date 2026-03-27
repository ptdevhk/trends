import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FacetGroup } from '@/components/search/FacetGroup'

describe('FacetGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the empty state when there are no facet values', () => {
    render(
      <FacetGroup
        title="Tags"
        items={[]}
        selectedValues={[]}
        onToggle={vi.fn()}
      />
    )

    expect(screen.getByText('No values available')).toBeInTheDocument()
    expect(screen.queryByText('Show less')).not.toBeInTheDocument()
  })

  it('uses case-insensitive selection and expands hidden facet values', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()

    render(
      <FacetGroup
        title="Tags"
        items={[
          { value: 'Machine Tools', label: 'Machine Tools', count: 12 },
          { value: 'Automation', count: 7 },
          { value: 'Robotics', count: 4 },
        ]}
        maxVisible={2}
        selectedValues={['machine tools']}
        onToggle={onToggle}
      />
    )

    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Machine Tools/i })).toHaveClass('bg-slate-900')
    expect(screen.queryByRole('button', { name: /Robotics/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show 1 more' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show 1 more' }))

    expect(screen.getByRole('button', { name: /Robotics/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Automation/i }))

    expect(onToggle).toHaveBeenCalledWith('Automation')
  })
})
