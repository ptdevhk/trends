import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { CandidateStatusRecord } from './useCandidateStatus'
import { useCandidateStatus } from './useCandidateStatus'

type ApiListResponse = { data: { success: boolean; items?: CandidateStatusRecord[] } }
type ApiPostResponse = { data: { success: boolean; item?: CandidateStatusRecord } }

const mockApiClient = vi.hoisted(() => ({
  GET: vi.fn(async (): Promise<ApiListResponse> => ({
    data: { success: true, items: [] },
  })),
  POST: vi.fn(async (): Promise<ApiPostResponse> => ({
    data: { success: true },
  })),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: mockApiClient,
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
  })

  it('loads items on mount when enabled', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: { success: true, items: [mockItem] },
    })

    const { result } = renderHook(() => useCandidateStatus(true))
    await act(async () => {})

    expect(result.current.items).toEqual([mockItem])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('does not load when disabled', async () => {
    const { result } = renderHook(() => useCandidateStatus(false))

    expect(result.current.items).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(mockApiClient.GET).not.toHaveBeenCalled()
  })

  it('sets error on API failure', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: { success: false },
    })

    const { result } = renderHook(() => useCandidateStatus(true))
    await act(async () => {})

    expect(result.current.error).toBe('Failed to load candidate status')
    expect(result.current.items).toEqual([])
  })

  it('sets error on network error', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: undefined,
      error: 'network',
    } as unknown as { data: ApiListResponse['data'] })

    const { result } = renderHook(() => useCandidateStatus(true))
    await act(async () => {})

    expect(result.current.error).toBe('Failed to load candidate status')
  })

  it('builds statusByIdentity map', async () => {
    const item2: CandidateStatusRecord = {
      ...mockItem,
      _id: 'id-2',
      identityKey: 'key-2',
      status: 'contacted',
    }
    mockApiClient.GET.mockResolvedValueOnce({
      data: { success: true, items: [mockItem, item2] },
    })

    const { result } = renderHook(() => useCandidateStatus(true))
    await act(async () => {})

    expect(result.current.statusByIdentity['key-1']).toEqual(mockItem)
    expect(result.current.statusByIdentity['key-2']).toEqual(item2)
  })

  it('updateStatus calls POST and reloads', async () => {
    mockApiClient.GET.mockResolvedValue({
      data: { success: true, items: [mockItem] },
    })
    mockApiClient.POST.mockResolvedValueOnce({
      data: { success: true, item: { ...mockItem, status: 'interviewing' as const } },
    })

    const { result } = renderHook(() => useCandidateStatus(true))
    await act(async () => {})

    let success = false
    await act(async () => {
      success = await result.current.updateStatus('key-1', 'interviewing', 'good fit')
    })

    expect(success).toBe(true)
    expect(mockApiClient.POST).toHaveBeenCalledWith('/api/candidate-status', {
      body: { identityKey: 'key-1', status: 'interviewing', notes: 'good fit' },
    })
  })

  it('updateStatus returns false for empty identityKey', async () => {
    const { result } = renderHook(() => useCandidateStatus(true))
    await act(async () => {})

    let success = true
    await act(async () => {
      success = await result.current.updateStatus('  ', 'interviewing')
    })

    expect(success).toBe(false)
    expect(mockApiClient.POST).not.toHaveBeenCalled()
  })

  it('updateStatus returns false on API failure', async () => {
    mockApiClient.GET.mockResolvedValue({
      data: { success: true, items: [] },
    })
    mockApiClient.POST.mockResolvedValueOnce({
      data: { success: false },
    })

    const { result } = renderHook(() => useCandidateStatus(true))
    await act(async () => {})

    let success = true
    await act(async () => {
      success = await result.current.updateStatus('key-1', 'interviewing')
    })

    expect(success).toBe(false)
    expect(result.current.error).toBe('Failed to update candidate status')
  })

  it('reload fetches fresh data', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: { success: true, items: [mockItem] },
    })

    const { result } = renderHook(() => useCandidateStatus(true))
    await act(async () => {})

    const updatedItem = { ...mockItem, status: 'hired' as const }
    mockApiClient.GET.mockResolvedValueOnce({
      data: { success: true, items: [updatedItem] },
    })

    await act(async () => {
      await result.current.reload()
    })

    expect(result.current.items).toEqual([updatedItem])
  })

  it('defaults to enabled when no argument given', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: { success: true, items: [] },
    })

    renderHook(() => useCandidateStatus())
    await act(async () => {})

    expect(mockApiClient.GET).toHaveBeenCalled()
  })
})
