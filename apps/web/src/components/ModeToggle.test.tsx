import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ModeToggle } from './ModeToggle'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'resumes.mode.ai') {
        return 'AI Mode'
      }

      return key
    },
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
    expect(screen.getByText('3')).toBeInTheDocument()
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
