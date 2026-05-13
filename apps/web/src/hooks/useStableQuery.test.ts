import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useStableQuery } from './useStableQuery'

let queryResult: unknown = undefined

vi.mock('convex/react', () => ({
  useQuery: () => queryResult,
}))

describe('useStableQuery', () => {
  beforeEach(() => {
    queryResult = undefined
  })

  it('returns undefined when query returns undefined', () => {
    queryResult = undefined
    const { result } = renderHook(() => useStableQuery('query' as never))
    expect(result.current).toBeUndefined()
  })

  it('returns query result when defined', () => {
    queryResult = { data: 'test' }
    const { result } = renderHook(() => useStableQuery('query' as never))
    expect(result.current).toEqual({ data: 'test' })
  })

  it('holds stale data when query returns undefined after having data', () => {
    queryResult = { data: 'first' }
    const { result, rerender } = renderHook(() => useStableQuery('query' as never))
    expect(result.current).toEqual({ data: 'first' })

    queryResult = undefined
    rerender()
    expect(result.current).toEqual({ data: 'first' })
  })

  it('updates when new non-undefined data arrives', () => {
    queryResult = { data: 'first' }
    const { result, rerender } = renderHook(() => useStableQuery('query' as never))
    expect(result.current).toEqual({ data: 'first' })

    queryResult = { data: 'second' }
    rerender()
    expect(result.current).toEqual({ data: 'second' })
  })
})
