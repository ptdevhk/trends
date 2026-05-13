import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useCandidateBlocks } from './useCandidateBlocks'

type BlockItem = { _id: string; identityKey: string; workspaceSlug: string; blockedAt: number; reason?: string }
type BlocksGetResponse = { data: { success: boolean; items: BlockItem[] } }

const mockApiClient = vi.hoisted(() => ({
  GET: vi.fn<(...args: unknown[]) => Promise<BlocksGetResponse>>(async () => ({ data: { success: true, items: [] } })),
  POST: vi.fn(async () => ({ data: { success: true } })),
  DELETE: vi.fn(async () => ({ data: { success: true, removed: true } })),
  PATCH: vi.fn(async () => ({ data: { success: true, updated: true } })),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: mockApiClient,
}))

describe('useCandidateBlocks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads blocks on mount when enabled', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: { success: true, items: [{ _id: '1', identityKey: 'user-1', workspaceSlug: 'ws', blockedAt: 1000 }] },
    })
    const { result } = renderHook(() => useCandidateBlocks(true))
    await act(async () => {})

    expect(result.current.items).toHaveLength(1)
    expect(result.current.blocksByIdentity['user-1']).toBeDefined()
  })

  it('does not fetch when disabled', async () => {
    const { result } = renderHook(() => useCandidateBlocks(false))
    await act(async () => {})

    expect(mockApiClient.GET).not.toHaveBeenCalled()
    expect(result.current.items).toEqual([])
  })

  it('builds blocksByIdentity map', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: {
        success: true,
        items: [
          { _id: '1', identityKey: 'a', workspaceSlug: 'ws', blockedAt: 1000 },
          { _id: '2', identityKey: 'b', workspaceSlug: 'ws', blockedAt: 2000 },
        ],
      },
    })
    const { result } = renderHook(() => useCandidateBlocks(true))
    await act(async () => {})

    expect(Object.keys(result.current.blocksByIdentity)).toEqual(['a', 'b'])
  })

  it('blockCandidates POSTs and reloads', async () => {
    mockApiClient.GET.mockResolvedValue({ data: { success: true, items: [] } })
    mockApiClient.POST.mockResolvedValueOnce({ data: { success: true } })

    const { result } = renderHook(() => useCandidateBlocks(true))
    await act(async () => {})

    let success = false
    await act(async () => {
      success = await result.current.blockCandidates(['key-1', 'key-2'], 'spam')
    })

    expect(success).toBe(true)
    expect(mockApiClient.POST).toHaveBeenCalledWith('/api/blocks', {
      body: { identityKeys: ['key-1', 'key-2'], reason: 'spam', blockedBy: undefined },
    })
  })

  it('blockCandidates returns false for empty input', async () => {
    const { result } = renderHook(() => useCandidateBlocks(true))
    await act(async () => {})

    let success = true
    await act(async () => {
      success = await result.current.blockCandidates([])
    })
    expect(success).toBe(false)
  })

  it('unblockCandidate DELETEs and reloads', async () => {
    mockApiClient.GET.mockResolvedValue({ data: { success: true, items: [] } })
    mockApiClient.DELETE.mockResolvedValueOnce({ data: { success: true, removed: true } })

    const { result } = renderHook(() => useCandidateBlocks(true))
    await act(async () => {})

    let removed = false
    await act(async () => {
      removed = await result.current.unblockCandidate('key-1')
    })

    expect(removed).toBe(true)
    expect(mockApiClient.DELETE).toHaveBeenCalledWith('/api/blocks', {
      params: { query: { identityKey: 'key-1' } },
    })
  })

  it('unblockCandidate returns false for empty key', async () => {
    const { result } = renderHook(() => useCandidateBlocks(true))
    await act(async () => {})

    let removed = true
    await act(async () => {
      removed = await result.current.unblockCandidate('  ')
    })
    expect(removed).toBe(false)
  })

  it('updateBlockReason PATCHes and reloads', async () => {
    mockApiClient.GET.mockResolvedValue({ data: { success: true, items: [] } })
    mockApiClient.PATCH.mockResolvedValueOnce({ data: { success: true, updated: true } })

    const { result } = renderHook(() => useCandidateBlocks(true))
    await act(async () => {})

    let updated = false
    await act(async () => {
      updated = await result.current.updateBlockReason('key-1', 'new reason')
    })

    expect(updated).toBe(true)
    expect(mockApiClient.PATCH).toHaveBeenCalledWith('/api/blocks', {
      body: { identityKey: 'key-1', reason: 'new reason' },
    })
  })

  it('sets error when API fails', async () => {
    mockApiClient.GET.mockResolvedValueOnce({ data: { success: false, items: [] } })
    const { result } = renderHook(() => useCandidateBlocks(true))
    await act(async () => {})

    expect(result.current.error).toBe('Failed to load candidate blocks')
  })
})
