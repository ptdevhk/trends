import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CompanyPolicyHiddenToggle } from './CompanyPolicyHiddenToggle'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string; count?: number }) => {
      if (options?.defaultValue?.includes('{{count}}') && typeof options.count === 'number') {
        return options.defaultValue.replace('{{count}}', String(options.count))
      }
      return options?.defaultValue ?? _key
    },
  }),
}))

describe('CompanyPolicyHiddenToggle', () => {
  it('renders nothing when no hidden rows and not showing', () => {
    const { container } = render(
      <CompanyPolicyHiddenToggle
        hiddenCount={0}
        showHidden={false}
        onShowHiddenChange={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('uses chip-style pills aligned with bulk bar', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <CompanyPolicyHiddenToggle
        hiddenCount={2}
        showHidden={false}
        onShowHiddenChange={onChange}
      />,
    )
    expect(screen.getByTestId('company-policy-hidden-count').className).toMatch(/rounded-full/)
    await user.click(screen.getByTestId('company-policy-show-hidden'))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
