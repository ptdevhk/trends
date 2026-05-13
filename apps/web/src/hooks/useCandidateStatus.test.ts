import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useCandidateStatus } from './useCandidateStatus'

const mockApiClient = vi.hoisted(() => ({
  GET: vi.fn(async () => ({ data: { success: true, items: [] } })),
  POST: vi.fn(async () => ({ data: { success: true } })),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: mockApiClient,
}))

describe('useCandidateStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads status on mount when enabled', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: {
        success: true,
        items: [
          { _id: '1', identityKey: 'user-1', workspaceSlug: 'ws', status: 'new', updatedAt: 1000 },
        ],
      },
    })
    const { result } = renderHook(() => useCandidateStatus(true))
    await act(async () => {})

    expect(result.current.items).toHaveLength(1)
    expect(result.current.statusByIdentity['user-1']).toBeDefined()
    expect(result.current.statusByIdentity['user-1'].status).toBe('new')
  })

  it('does not fetch when disabled', async () => {
    const { result } = renderHook(() => useCandidateStatus(false))
    await act(async () => {})

    expect(mockApiClient.GET).not.toHaveBeenCalled()
    expect(result.current.items).toEqual([])
  })

  it('builds statusByIdentity map', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: {
        success: true,
        items: [
          { _id: '1', identityKey: 'a', workspaceSlug: 'ws', status: 'new', updatedAt: 1000 },
          { _id: '2', identityKey: 'b', workspaceSlug: 'ws', status: 'contacted', updatedAt: 2000 },
        ],
      },
    })
    const { result } = renderHook(() => useCandidateStatus(true))
    await act(async () => {})

    expect(Object.keys(result.current.statusByIdentity)).toEqual(['a', 'b'])
    expect(result.current.statusByIdentity['a'].status).toBe('new')
    expect(result.current.statusByIdentity['b'].status).toBe('contacted')
  })

  it('updateStatus POSTs and reloads', async () => {
    mockApiClient.GET.mockResolvedValue({ data: { success: true, items: [] } })
    mockApiClient.POST.mockResolvedValueOnce({ data: { success: true } })

    const { result } = renderHook(() => useCandidateStatus(true))
    await act(async () => {})

    let success = false
    await act(async () => {
      success = await result.current.updateStatus('key-1', 'contacted', 'reached out')
    })

    expect(success).toBe(true)
    expect(mockApiClient.POST).toHaveBeenCalledWith('/api/candidate-status', {
      body: { identityKey: 'key-1', status: 'contacted', notes: 'reached out' },
    })
  })

  it('updateStatus returns false for empty key', async () => {
    const { result } = renderHook(() => useCandidateStatus(true))
    await act(async () => {})

    let success = true
    await act(async () => {
      success = await result.current.updateStatus('  ', 'new')
    })
    expect(success).toBe(false)
    expect(mockApiClient.POST).not.toHaveBeenCalled()
  })

  it('updateStatus returns false on API failure', async () => {
    mockApiClient.GET.mockResolvedValue({ data: { success: true, items: [] } })
    mockApiClient.POST.mockResolvedValueOnce({ data: { success: false } })

    const { result } = renderHook(() => useCandidateStatus(true))
    await act(async () => {})

    let success = true
    await act(async () => {
      success = await result.current.updateStatus('key-1', 'new')
    })
    expect(success).toBe(false)
    expect(result.current.error).toBe('Failed to update candidate status')
  })

  it('sets error when initial load fails', async () => {
    mockApiClient.GET.mockResolvedValueOnce({ data: { success: false } })
    const { result } = renderHook(() => useCandidateStatus(true))
    await act(async () => {})

    expect(result.current.error).toBe('Failed to load candidate status')
  })

  it('sets error on API error response', async () => {
    mockApiClient.GET.mockResolvedValueOnce({ data: null, error: 'network' })
    const { result } = renderHook(() => useCandidateStatus(true))
    await act(async () => {})

    expect(result.current.error).toBe('Failed to load candidate status')
  })

  it('clears items when disabled after being enabled', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: {
        success: true,
        items: [{ _id: '1', identityKey: 'a', workspaceSlug: 'ws', status: 'new', updatedAt: 1000 }],
      },
    })
    const { result, rerender } = renderHook(
      (props: { enabled: boolean }) => useCandidateStatus(props.enabled),
      { initialProps: { enabled: true } },
    )
    await act(async () => {})

    expect(result.current.items).toHaveLength(1)

    rerender({ enabled: false })
    await act(async () => {})

    expect(result.current.items).toEqual([])
  })
})
