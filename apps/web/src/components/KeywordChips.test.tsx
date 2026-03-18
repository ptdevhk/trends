import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KeywordChips } from './KeywordChips'

const useIndustryKeywordsMock = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useIndustryKeywords', () => ({
  useIndustryKeywords: (...args: unknown[]) => useIndustryKeywordsMock(...args),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

describe('KeywordChips market filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    const cnLocation = {
      id: 'loc-cn',
      keyword: '广东',
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
    const hiddenKeyword = {
      id: 'kw-hidden',
      keyword: 'Hidden Seed',
      category: 'custom',
      markets: ['CN' as const],
      visible: false,
    }

    useIndustryKeywordsMock.mockReturnValue({
      keywords: [
        cnLocation,
        myLocation,
        cnKeyword,
        myKeyword,
        sharedKeyword,
        hiddenKeyword,
      ],
      grouped: {
        machining: [],
        lathe: [],
        edm: [],
        measurement: [],
        smt: [],
        '3d_printing': [],
        location: [cnLocation, myLocation],
        brand: [],
        custom: [cnKeyword, myKeyword, sharedKeyword, hiddenKeyword],
      },
      hotKeywords: [cnKeyword, myKeyword, sharedKeyword, cnLocation, myLocation, hiddenKeyword],
      loading: false,
      error: null,
      refresh: vi.fn(),
      workflowSeeds: [],
    })
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
    expect(screen.queryByRole('button', { name: '广东' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '销售' })).not.toBeInTheDocument()
    expect(screen.queryByText('Hidden Seed')).not.toBeInTheDocument()
  })
})
