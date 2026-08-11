import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FacetGroup } from '@/components/search/FacetGroup'

const mockT = (key: string, options?: string | Record<string, string | number | undefined>) => {
  if (typeof options === 'string') {
    return options
  }

  const defaultValue =
    options && typeof options === 'object' && typeof options.defaultValue === 'string'
      ? options.defaultValue
      : key

  return defaultValue.replace(/\{\{(\w+)\}\}/g, (_: string, token: string) => {
    const value = options && typeof options === 'object' ? options[token] : undefined
    return value === undefined || value === null ? '' : String(value)
  })
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

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

    expect(screen.getByText('resumes.searchPage.facets.emptyLabel')).toBeInTheDocument()
    expect(screen.queryByText(/Show less/i)).not.toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: /Show 1 more/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Show 1 more/i }))

    expect(screen.getByRole('button', { name: /Robotics/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Show less/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Automation/i }))

    expect(onToggle).toHaveBeenCalledWith('Automation')
  })

  it('collapses expanded values again after show less', async () => {
    const user = userEvent.setup()

    render(
      <FacetGroup
        title="Tags"
        items={[
          { value: 'Machine Tools', count: 12 },
          { value: 'Automation', count: 7 },
          { value: 'Robotics', count: 4 },
        ]}
        maxVisible={2}
        selectedValues={[]}
        onToggle={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: /Show 1 more/i }))
    expect(screen.getByRole('button', { name: /Robotics/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Show less/i }))

    expect(screen.queryByRole('button', { name: /Robotics/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Show 1 more/i })).toBeInTheDocument()
  })

  it('omits the show-more control when the visible limit already covers every value', () => {
    render(
      <FacetGroup
        title="Tags"
        items={[
          { value: 'Machine Tools', count: 12 },
          { value: 'Automation', count: 7 },
        ]}
        maxVisible={2}
        selectedValues={[]}
        onToggle={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /Machine Tools/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Automation/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Show /i })).not.toBeInTheDocument()
  })
})
