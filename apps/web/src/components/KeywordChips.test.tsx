import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KeywordChips } from './KeywordChips'

const useIndustryKeywordsMock = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useIndustryKeywords', () => ({
  useIndustryKeywords: (...args: unknown[]) => useIndustryKeywordsMock(...args),
}))

const mockT = (_key: string, fallback?: string) => fallback ?? _key;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

function buildKeywordHooksValue(options?: {
  includeLowercaseHotCnc?: boolean
}) {
  const cnLocation = {
    id: 'loc-cn',
    keyword: '广东',
    category: 'location',
    markets: ['CN' as const],
    visible: true,
  }
  const chinaLocation = {
    id: 'loc-china',
    keyword: 'China',
    category: 'location',
    markets: ['CN' as const],
    visible: true,
  }
  const myLocation = {
    id: 'loc-my',
    keyword: 'Kuala Lumpur MY',
    category: 'location',
    markets: ['MY' as const],
    visible: true,
  }
  const cnKeyword = {
    id: 'kw-cn',
    keyword: '销售',
    category: 'custom',
    markets: ['CN' as const],
    visible: true,
  }
  const myKeyword = {
    id: 'kw-my',
    keyword: 'Sales Engineer',
    category: 'custom',
    markets: ['MY' as const],
    visible: true,
  }
  const sharedKeyword = {
    id: 'kw-shared',
    keyword: 'CNC',
    category: 'custom',
    markets: ['CN' as const, 'MY' as const],
    visible: true,
  }
  const lowercaseSharedKeyword = {
    ...sharedKeyword,
    id: 'kw-shared-lower',
    keyword: 'cnc',
  }
  const hiddenKeyword = {
    id: 'kw-hidden',
    keyword: 'Hidden Seed',
    category: 'custom',
    markets: ['CN' as const],
    visible: false,
  }

  const customKeywords = options?.includeLowercaseHotCnc
    ? [cnKeyword, myKeyword, sharedKeyword, lowercaseSharedKeyword, hiddenKeyword]
    : [cnKeyword, myKeyword, sharedKeyword, hiddenKeyword]

  return {
    keywords: [
      cnLocation,
      chinaLocation,
      myLocation,
      ...customKeywords,
    ],
    grouped: {
      machining: [],
      lathe: [],
      edm: [],
      measurement: [],
      smt: [],
      '3d_printing': [],
      location: [chinaLocation, cnLocation, myLocation],
      brand: [],
      custom: customKeywords,
    },
    hotKeywords: [
      ...customKeywords,
      chinaLocation,
      cnLocation,
      myLocation,
    ],
    loading: false,
    error: null,
    refresh: vi.fn(),
    workflowSeeds: [],
  }
}

describe('KeywordChips market filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useIndustryKeywordsMock.mockReturnValue(buildKeywordHooksValue())
  })

  it('shows only CN chips for the CN market and only MY chips for the MY market', () => {
    const { rerender } = render(
      <KeywordChips
        value={[]}
        onChange={vi.fn()}
        market="CN"
      />,
    )

    expect(screen.getByRole('button', { name: '广东' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'China' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'CNC' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '销售' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Kuala Lumpur MY' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sales Engineer' })).not.toBeInTheDocument()
    expect(screen.queryByText('Hidden Seed')).not.toBeInTheDocument()

    rerender(
      <KeywordChips
        value={[]}
        onChange={vi.fn()}
        market="MY"
      />,
    )

    expect(screen.getByRole('button', { name: 'Kuala Lumpur MY' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'CNC' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sales Engineer' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'China' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '广东' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '销售' })).not.toBeInTheDocument()
    expect(screen.queryByText('Hidden Seed')).not.toBeInTheDocument()
  })

  it('renders one logical hot chip when hot keywords contain mixed-case duplicates', () => {
    useIndustryKeywordsMock.mockReturnValue(buildKeywordHooksValue({ includeLowercaseHotCnc: true }))

    render(
      <KeywordChips
        value={[]}
        onChange={vi.fn()}
        market="CN"
      />,
    )

    expect(screen.getAllByRole('button', { name: /cnc/i })).toHaveLength(1)
  })

  it('treats a lowercase selected keyword as selecting the hot chip label', () => {
    render(
      <KeywordChips
        value={['cnc']}
        onChange={vi.fn()}
        market="CN"
      />,
    )

    expect(screen.getByRole('button', { name: 'CNC' })).toHaveClass('bg-primary')
  })

  it('removes the existing mixed-case keyword instead of adding a duplicate when toggled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <KeywordChips
        value={['cnc']}
        onChange={onChange}
        market="CN"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'CNC' }))

    expect(onChange).toHaveBeenCalledWith([])
  })

  it('deduplicates custom and additional selected chips for case-only variants', () => {
    render(
      <KeywordChips
        value={['Custom Extra', 'custom extra']}
        onChange={vi.fn()}
        market="CN"
      />,
    )

    expect(screen.getAllByRole('button', { name: /custom extra/i })).toHaveLength(2)
  })
})
