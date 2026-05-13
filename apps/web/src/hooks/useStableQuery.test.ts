import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStableQuery } from './useStableQuery'

const useQueryMock = vi.hoisted(() => vi.fn())

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}))

describe('useStableQuery', () => {
  beforeEach(() => {
    useQueryMock.mockReset()
  })

  it('returns undefined when underlying useQuery returns undefined initially', () => {
    useQueryMock.mockReturnValue(undefined)
    const { result } = renderHook(() => useStableQuery('q:any' as never))
    expect(result.current).toBeUndefined()
  })

  it('returns the value when useQuery returns a value', () => {
    useQueryMock.mockReturnValue({ id: 1 })
    const { result } = renderHook(() => useStableQuery('q:any' as never))
    expect(result.current).toEqual({ id: 1 })
  })

  it('holds the last non-undefined value when useQuery later returns undefined', () => {
    useQueryMock.mockReturnValueOnce({ id: 1 })
    const { result, rerender } = renderHook(() => useStableQuery('q:any' as never))
    expect(result.current).toEqual({ id: 1 })

    useQueryMock.mockReturnValueOnce(undefined)
    rerender()
    expect(result.current).toEqual({ id: 1 })
  })

  it('updates to a new non-undefined value', () => {
    useQueryMock.mockReturnValueOnce({ id: 1 })
    const { result, rerender } = renderHook(() => useStableQuery('q:any' as never))
    expect(result.current).toEqual({ id: 1 })

    useQueryMock.mockReturnValueOnce({ id: 2 })
    rerender()
    expect(result.current).toEqual({ id: 2 })
  })

  it('passes the query and args through to useQuery', () => {
    useQueryMock.mockReturnValue(undefined)
    renderHook(() => useStableQuery('q:foo' as never, { a: 1 } as never))
    expect(useQueryMock).toHaveBeenCalledWith('q:foo', { a: 1 })
  })
})
