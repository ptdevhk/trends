import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { FilterPanel } from './FilterPanel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('FilterPanel', () => {
  it('keeps badges and toolbar in one header strip across collapse states', async () => {
    const user = userEvent.setup()

    render(
      <FilterPanel
        filters={{
          minExperience: 1,
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

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('≥1年')).toBeInTheDocument()
    expect(screen.getByText('25-35岁')).toBeInTheDocument()
    expect(screen.getByText('广东, 江苏')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '分享' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'resumes.filters.clear' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'resumes.filters.apply' })).toBeInTheDocument()

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '分享' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'resumes.filters.clear' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'resumes.filters.apply' })).toBeInTheDocument()
    expect(screen.getByText('≥1年')).toBeInTheDocument()
    expect(screen.getByText('25-35岁')).toBeInTheDocument()
    expect(screen.getByText('广东, 江苏')).toBeInTheDocument()
  })
})
