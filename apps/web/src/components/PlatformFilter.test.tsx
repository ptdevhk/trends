import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PlatformFilter } from '@/components/PlatformFilter'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}))

vi.mock('@/lib/api', () => ({
  PLATFORMS: [
    { id: 'zhihu', name: 'Zhihu Hot List' },
    { id: 'weibo', name: 'Weibo Hot Search' },
  ],
}))

describe('PlatformFilter', () => {
  it('renders platform label and select', () => {
    render(<PlatformFilter value="" onChange={vi.fn()} />)
    expect(screen.getByText('trends.platform:')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('renders all platform options including "all"', () => {
    render(<PlatformFilter value="" onChange={vi.fn()} />)
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(3) // all + zhihu + weibo
  })

  it('calls onChange when a platform is selected', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<PlatformFilter value="" onChange={onChange} />)
    await user.selectOptions(screen.getByRole('combobox'), 'zhihu')
    expect(onChange).toHaveBeenCalledWith('zhihu')
  })

  it('reflects the current value', () => {
    render(<PlatformFilter value="weibo" onChange={vi.fn()} />)
    expect(screen.getByRole('combobox')).toHaveValue('weibo')
  })
})
