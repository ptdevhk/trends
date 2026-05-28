import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { CandidateStatusRecord } from './useCandidateStatus'
import { useCandidateStatus } from './useCandidateStatus'

const upsertMock = vi.fn(async () => 'doc-id')
let useQueryArg: unknown = undefined

const mockQueryItems = vi.hoisted(() => ({ value: [] as CandidateStatusRecord[] | undefined }))

vi.mock('convex/react', () => ({
  useQuery: (_api: unknown, args: unknown) => {
    useQueryArg = args
    if (args === 'skip') return undefined
    return mockQueryItems.value
  },
  useMutation: () => upsertMock,
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'dev' }),
}))

vi.mock('../../../../packages/convex/convex/_generated/api', () => ({
  api: {
    candidate_status: {
      list: 'candidate_status:list',
      upsert: 'candidate_status:upsert',
    },
  },
}))

const mockItem: CandidateStatusRecord = {
  _id: 'id-1',
  identityKey: 'key-1',
  workspaceSlug: 'dev',
  status: 'new',
  updatedAt: 1000,
}

describe('useCandidateStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryItems.value = []
    useQueryArg = undefined
  })

  it('returns items from Convex query', () => {
    mockQueryItems.value = [mockItem]

    const { result } = renderHook(() => useCandidateStatus(true))

    expect(result.current.items).toEqual([mockItem])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('passes skip to useQuery when disabled', () => {
    renderHook(() => useCandidateStatus(false))

    expect(useQueryArg).toBe('skip')
  })

  it('returns empty items when disabled', () => {
    const { result } = renderHook(() => useCandidateStatus(false))

    expect(result.current.items).toEqual([])
  })

  it('shows loading=true when Convex query is still loading (undefined)', () => {
    mockQueryItems.value = undefined

    const { result } = renderHook(() => useCandidateStatus(true))

    expect(result.current.loading).toBe(true)
    expect(result.current.items).toEqual([])
  })

  it('builds statusByIdentity map from items', () => {
    const item2: CandidateStatusRecord = {
      ...mockItem,
      _id: 'id-2',
      identityKey: 'key-2',
      status: 'contacted',
    }
    mockQueryItems.value = [mockItem, item2]

    const { result } = renderHook(() => useCandidateStatus(true))

    expect(result.current.statusByIdentity['key-1']).toEqual(mockItem)
    expect(result.current.statusByIdentity['key-2']).toEqual(item2)
  })

  it('updateStatus calls Convex upsert with correct args', async () => {
    mockQueryItems.value = [mockItem]
    const { result } = renderHook(() => useCandidateStatus(true))

    let success = false
    await act(async () => {
      success = await result.current.updateStatus('key-1', 'interviewing', 'good fit')
    })

    expect(success).toBe(true)
    expect(upsertMock).toHaveBeenCalledWith({
      identityKey: 'key-1',
      status: 'interviewing',
      workspaceSlug: 'dev',
      notes: 'good fit',
    })
  })

  it('updateStatus returns false for empty identityKey', async () => {
    const { result } = renderHook(() => useCandidateStatus(true))

    let success = true
    await act(async () => {
      success = await result.current.updateStatus('  ', 'interviewing')
    })

    expect(success).toBe(false)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('updateStatus returns false when Convex mutation throws', async () => {
    upsertMock.mockRejectedValueOnce(new Error('Convex error'))
    const { result } = renderHook(() => useCandidateStatus(true))

    let success = true
    await act(async () => {
      success = await result.current.updateStatus('key-1', 'shortlisted')
    })

    expect(success).toBe(false)
  })

  it('reload is a no-op (Convex is reactive)', () => {
    const { result } = renderHook(() => useCandidateStatus(true))

    expect(() => result.current.reload()).not.toThrow()
  })

  it('defaults to enabled when no argument given', () => {
    mockQueryItems.value = [mockItem]
    const { result } = renderHook(() => useCandidateStatus())

    expect(result.current.items).toEqual([mockItem])
  })
})
