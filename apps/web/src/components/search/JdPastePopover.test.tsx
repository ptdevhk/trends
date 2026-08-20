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

const zhHans: Record<string, string> = {
  'resumes.searchPage.jdPaste.title': '粘贴职位描述以提取关键词',
  'resumes.searchPage.jdPaste.placeholder': '在此粘贴职位描述文本，以提取岗位、产品和领域关键词。',
  'resumes.searchPage.jdPaste.extract': '提取关键词',
  'resumes.searchPage.jdPaste.cancel': '取消',
}

// Module-scope `t` (stable identity across renders) per repo convention.
let mockLanguage = 'en'
const mockT = (key: string, options?: string | Record<string, unknown>) => {
  if (mockLanguage === 'zh-Hans' && zhHans[key]) {
    return zhHans[key]
  }
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
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

describe('JdPastePopover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLanguage = 'en'
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

  it('localizes the popover strings when the app language is zh-Hans', async () => {
    mockLanguage = 'zh-Hans'

    render(
      <JdPastePopover
        onApplyKeywords={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('粘贴职位描述以提取关键词')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('在此粘贴职位描述文本，以提取岗位、产品和领域关键词。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '提取关键词' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument()
  })
})
