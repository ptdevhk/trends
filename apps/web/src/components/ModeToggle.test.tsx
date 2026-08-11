import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ModeToggle } from './ModeToggle'

const mockT = (key: string, options?: string | Record<string, unknown>) => {
  if (typeof options === 'string') {
    return options
  }

  const defaultValue =
    options && typeof options === 'object' && typeof options.defaultValue === 'string'
      ? options.defaultValue
      : key
  return defaultValue.replace(/\{\{(\w+)\}\}/g, (_, token: string) => {
    const value = options && typeof options === 'object' ? options[token] : undefined
    return value === undefined || value === null ? '' : String(value)
  })
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

describe('ModeToggle', () => {
  it('renders AI mode text with a switch and badge when enabled', () => {
    render(
      <ModeToggle
        mode="ai"
        onModeChange={vi.fn()}
        aiStats={{ avgScore: 91.5, matched: 3, processed: 5 }}
      />,
    )

    expect(screen.getByText('AI Mode')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'AI Mode' })).toBeChecked()
    const matchedBadge = screen.getByText('3')
    expect(matchedBadge).toBeInTheDocument()
    expect(matchedBadge.className).toContain('bg-sky-700')
  })

  it('toggles between ai and original states', async () => {
    const user = userEvent.setup()
    const onModeChange = vi.fn()

    render(<ModeToggle mode="original" onModeChange={onModeChange} />)

    const switchToggle = screen.getByRole('switch', { name: 'AI Mode' })
    expect(switchToggle).not.toBeChecked()

    await user.click(switchToggle)

    expect(onModeChange).toHaveBeenCalledWith('ai')
  })
})
