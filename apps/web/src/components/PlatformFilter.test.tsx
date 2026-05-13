import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { PlatformFilter } from '@/components/PlatformFilter'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | { defaultValue?: string; [key: string]: unknown }) => {
      if (typeof options === 'string') return options
      if (options?.defaultValue) {
        return options.defaultValue.replace(/\{\{(\w+)\}\}/g, (_match: string, k: string) => String(options[k] ?? `{{${k}}}`))
      }
      return key
    },
  }),
}))

vi.mock('@/lib/api', () => ({
  PLATFORMS: [
    { id: 'zhihu', name: 'Zhihu Hot List' },
    { id: 'weibo', name: 'Weibo Hot Search' },
  ],
}))

describe('PlatformFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders platform label and select', () => {
    render(<PlatformFilter value="" onChange={vi.fn()} />)
    expect(screen.getByText('trends.platform:')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('renders all platform options including "all"', () => {
    render(<PlatformFilter value="" onChange={vi.fn()} />)
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('calls onChange when a platform is selected', async () => {
    const onChange = vi.fn()
    render(<PlatformFilter value="" onChange={onChange} />)
    await userEvent.setup().selectOptions(screen.getByRole('combobox'), 'zhihu')
    expect(onChange).toHaveBeenCalledWith('zhihu')
  })

  it('reflects the current value', () => {
    render(<PlatformFilter value="weibo" onChange={vi.fn()} />)
    expect(screen.getByRole('combobox')).toHaveValue('weibo')
  })
})
