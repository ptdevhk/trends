import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../../packages/convex/convex/_generated/api'
import { useConvexResumeDetail } from './useConvexResumes'

const mockUseQuery = vi.hoisted(() => vi.fn())

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}))

describe('useConvexResumeDetail', () => {
  beforeEach(() => {
    mockUseQuery.mockReset()
    mockUseQuery.mockReturnValue(undefined)
  })

  it('skips the query for ids that are not Convex-shaped (URL route segments)', () => {
    const { result } = renderHook(() => useConvexResumeDetail('audit-compliance' as never))

    expect(mockUseQuery).toHaveBeenCalledWith(api.resumes.getResumeDetail, 'skip')
    expect(result.current).toEqual({ resume: null, loading: false })
  })

  it('skips the query for null and undefined ids', () => {
    const { result: nullResult } = renderHook(() => useConvexResumeDetail(null))
    const { result: undefinedResult } = renderHook(() => useConvexResumeDetail(undefined))

    expect(mockUseQuery).toHaveBeenCalledTimes(2)
    expect(mockUseQuery).toHaveBeenNthCalledWith(1, api.resumes.getResumeDetail, 'skip')
    expect(mockUseQuery).toHaveBeenNthCalledWith(2, api.resumes.getResumeDetail, 'skip')
    expect(nullResult.current).toEqual({ resume: null, loading: false })
    expect(undefinedResult.current).toEqual({ resume: null, loading: false })
  })

  it('fires the query for a valid Convex-shaped id', () => {
    const id = 'k175jsrvmk5x6fhrgzqgn062rs8cr7c1'
    const { result } = renderHook(() => useConvexResumeDetail(id as never))

    expect(mockUseQuery).toHaveBeenCalledWith(api.resumes.getResumeDetail, { resumeId: id })
    expect(result.current).toEqual({ resume: null, loading: true })
  })

  it('returns the mapped resume when the query resolves', () => {
    const id = 'k175jsrvmk5x6fhrgzqgn062rs8cr7c1'
    mockUseQuery.mockReturnValue({
      _id: id,
      content: { name: 'Ada Lovelace' },
      company: 'Analytical Engine Ltd',
    })
    const { result } = renderHook(() => useConvexResumeDetail(id as never))

    expect(result.current.loading).toBe(false)
    expect(result.current.resume?.resumeId).toBe(id)
    expect(result.current.resume?.name).toBe('Ada Lovelace')
  })
})
