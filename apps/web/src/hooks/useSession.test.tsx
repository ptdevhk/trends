import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSession } from './useSession'

const { useQueryMock, useMutationMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
  useMutationMock: vi.fn(),
}))

const { toastInfoMock } = vi.hoisted(() => ({
  toastInfoMock: vi.fn(),
}))

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'dev' }),
}))

vi.mock('sonner', () => ({
  toast: {
    info: (...args: unknown[]) => toastInfoMock(...args),
  },
}))

describe('useSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()

    useQueryMock.mockReturnValue({
      config: {
        location: '广东,江苏',
        keywords: ['CNC', '销售'],
        jobDescriptionId: 'lathe-sales',
        filters: {
          minExperience: 1,
          minAge: 25,
          maxAge: 35,
        },
      },
      reviewedResumeIds: ['resume-1'],
    })
    useMutationMock.mockReturnValue(vi.fn())
  })

  it('does not auto-restore the previous screening session into live search state', async () => {
    const { result } = renderHook(() => useSession())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.location).toBe('')
    expect(result.current.keywords).toEqual([])
    expect(result.current.jobDescriptionId).toBeUndefined()
    expect(result.current.filters).toEqual({})
    expect(result.current.reviewedIdsSet.has('resume-1')).toBe(true)
    expect(toastInfoMock).not.toHaveBeenCalled()
  })
})
