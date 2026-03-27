import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JdPastePopover } from '@/components/search/JdPastePopover'

const postMock = vi.fn()

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    POST: (...args: unknown[]) => postMock(...args),
  },
}))

describe('JdPastePopover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('extracts keywords and applies them to the parent flow', async () => {
    const user = userEvent.setup()
    const onApplyKeywords = vi.fn()
    const onClose = vi.fn()

    postMock.mockResolvedValueOnce({
      data: {
        success: true,
        keywords: ['Business Development', 'Machine Tools'],
      },
    })

    render(
      <JdPastePopover
        onApplyKeywords={onApplyKeywords}
        onClose={onClose}
      />
    )

    await user.type(
      screen.getByPlaceholderText('Paste the job description text here to extract role, product, and domain keywords.'),
      'Business development manager for machine tools in Malaysia.'
    )
    await user.click(screen.getByRole('button', { name: 'Extract keywords' }))

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/api/job-descriptions/extract-keywords', {
        body: {
          text: 'Business development manager for machine tools in Malaysia.',
        },
      })
    })

    expect(onApplyKeywords).toHaveBeenCalledWith(['Business Development', 'Machine Tools'])
    expect(onClose).toHaveBeenCalled()
  })

  it('shows an inline error when extraction fails', async () => {
    const user = userEvent.setup()

    postMock.mockResolvedValueOnce({
      error: new Error('network failed'),
    })

    render(
      <JdPastePopover
        onApplyKeywords={vi.fn()}
        onClose={vi.fn()}
      />
    )

    await user.type(
      screen.getByPlaceholderText('Paste the job description text here to extract role, product, and domain keywords.'),
      'Machine tools sales engineer'
    )
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(await screen.findByText('Failed to extract keywords from the job description')).toBeInTheDocument()
  })

  it('closes on escape without calling extraction', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <JdPastePopover
        onApplyKeywords={vi.fn()}
        onClose={onClose}
      />
    )

    await user.type(
      screen.getByPlaceholderText('Paste the job description text here to extract role, product, and domain keywords.'),
      'Machine tools sales engineer'
    )
    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
    expect(postMock).not.toHaveBeenCalled()
  })
})
