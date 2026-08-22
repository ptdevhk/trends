import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { FilterPanel } from './FilterPanel'

const mockT = (key: string, options?: Record<string, unknown>) => {
  const labels: Record<string, string> = {
    'resumes.filters.badges.maxExperience': '≤{{value}} years',
    'resumes.filters.badges.ageRange': '{{min}}-{{max}} years old',
    'resumes.filters.badges.minAge': '≥{{value}} years old',
    'resumes.filters.badges.maxAge': '≤{{value}} years old',
  }
  const template = labels[key] ?? key
  return template.replace(/\{\{(\w+)\}\}/g, (_match, token: string) => String(options?.[token] ?? ''))
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

describe('FilterPanel', () => {
  it('keeps badges and toolbar in one header strip across collapse states', async () => {
    const user = userEvent.setup()

    render(
      <FilterPanel
        filters={{
          minAge: 25,
          maxAge: 35,
          locations: ['广东', '江苏'],
        }}
        onFiltersChange={vi.fn()}
        defaultCollapsed={true}
        headerAction={<button type="button">分享</button>}
      />
    )

    const toggle = screen.getByRole('button', { name: /resumes\.filters\.title/i })
    const clearButton = screen.getByRole('button', { name: 'resumes.filters.clear' })
    const applyButton = screen.getByRole('button', { name: 'resumes.filters.apply' })

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle.className).toContain('min-h-10')
    expect(screen.getByText('25-35 years old')).toBeInTheDocument()
    expect(screen.getByText('广东, 江苏')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '分享' })).toBeInTheDocument()
    expect(clearButton).toBeInTheDocument()
    expect(clearButton).toHaveClass('h-10')
    expect(applyButton).toBeInTheDocument()
    expect(applyButton).toHaveClass('h-10')

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '分享' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'resumes.filters.clear' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'resumes.filters.apply' })).toBeInTheDocument()
    expect(screen.getByText('25-35 years old')).toBeInTheDocument()
    expect(screen.getByText('广东, 江苏')).toBeInTheDocument()
  })

  it('renders 4 machine-origin options', async () => {
    render(
      <FilterPanel
        filters={{}}
        onFiltersChange={vi.fn()}
        defaultCollapsed={false}
      />
    )

    expect(screen.getByText('resumes.filters.machineOrigin')).toBeInTheDocument()
    const combobox = screen.getByRole('combobox')
    expect(combobox).toBeInTheDocument()
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(4)
    expect(options[0]).toHaveTextContent('resumes.filters.machineOriginOptions.all')
    expect(options[1]).toHaveTextContent('resumes.filters.machineOriginOptions.international')
    expect(options[2]).toHaveTextContent('resumes.filters.machineOriginOptions.domestic')
    expect(options[3]).toHaveTextContent('resumes.filters.machineOriginOptions.unknown')
  })

  it('choosing domestic + Apply calls onFiltersChange with machineOrigin', async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()

    render(
      <FilterPanel
        filters={{}}
        onFiltersChange={onFiltersChange}
        defaultCollapsed={false}
      />
    )

    const combobox = screen.getByRole('combobox')
    await user.selectOptions(combobox, 'domestic')
    await user.click(screen.getByRole('button', { name: 'resumes.filters.apply' }))

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ machineOrigin: 'domestic' }),
    )
  })

  it('selecting all + Apply leaves machineOrigin undefined', async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()

    render(
      <FilterPanel
        filters={{ machineOrigin: 'domestic' }}
        onFiltersChange={onFiltersChange}
        defaultCollapsed={false}
      />
    )

    const combobox = screen.getByRole('combobox')
    const allOption = screen.getByRole('option', { name: 'resumes.filters.machineOriginOptions.all' })
    await user.selectOptions(combobox, allOption)
    await user.click(screen.getByRole('button', { name: 'resumes.filters.apply' }))

    const payload = onFiltersChange.mock.calls[0]?.[0]
    expect(payload.machineOrigin).toBeUndefined()
  })

  it('Clear resets machine origin to empty and calls onFiltersChange with {}', async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()

    render(
      <FilterPanel
        filters={{ machineOrigin: 'domestic' }}
        onFiltersChange={onFiltersChange}
        defaultCollapsed={false}
      />
    )

    const combobox = screen.getByRole('combobox') as HTMLSelectElement
    expect(combobox.value).toBe('domestic')

    await user.click(screen.getByRole('button', { name: 'resumes.filters.clear' }))

    expect(combobox.value).toBe('')
    expect(onFiltersChange).toHaveBeenCalledWith({})
  })
})
