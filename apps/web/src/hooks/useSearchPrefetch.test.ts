import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const useQueryMock = vi.hoisted(() => vi.fn())
vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}))

vi.mock('../../../../packages/convex/convex/_generated/api', () => ({
  api: { resumes_search: { search: 'resumes_search:search' } },
}))

import { useSearchPrefetch } from '@/hooks/useSearchPrefetch'

describe('useSearchPrefetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes query to useQuery when query is provided', () => {
    useQueryMock.mockReturnValue([])
    const { result } = renderHook(() => useSearchPrefetch('React'))
    expect(useQueryMock).toHaveBeenCalledWith('resumes_search:search', { query: 'React', limit: 10 })
    expect(result.current).toEqual([])
  })

  it('skips query when query is empty', () => {
    useQueryMock.mockReturnValue(undefined)
    const { result } = renderHook(() => useSearchPrefetch(''))
    expect(useQueryMock).toHaveBeenCalledWith('resumes_search:search', 'skip')
    expect(result.current).toBeUndefined()
  })

  it('skips query when query is undefined', () => {
    useQueryMock.mockReturnValue(undefined)
    const { result } = renderHook(() => useSearchPrefetch(undefined))
    expect(useQueryMock).toHaveBeenCalledWith('resumes_search:search', 'skip')
    expect(result.current).toBeUndefined()
  })

  it('trims whitespace from query', () => {
    useQueryMock.mockReturnValue([])
    renderHook(() => useSearchPrefetch('  React  '))
    expect(useQueryMock).toHaveBeenCalledWith('resumes_search:search', { query: 'React', limit: 10 })
  })
})
