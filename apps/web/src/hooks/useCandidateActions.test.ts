import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useCandidateActions } from './useCandidateActions'

const mockApiClient = vi.hoisted(() => ({
  GET: vi.fn(async () => ({ data: { success: true, actions: [] } })),
  POST: vi.fn(async () => ({ data: { success: true, action: {} } })),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: mockApiClient,
}))

vi.mock('@/types/resume', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/types/resume')>()
  return {
    ...actual,
    actionToAiFeedback: (actionType: string) => {
      if (actionType === 'ai_score_upvote') return { target: 'ai_score', sentiment: 'positive' }
      if (actionType === 'ai_score_downvote') return { target: 'ai_score', sentiment: 'negative' }
      return undefined
    },
  }
})

describe('useCandidateActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not fetch when disabled', async () => {
    renderHook(() => useCandidateActions('s-1', undefined, false))
    await act(async () => {})

    expect(mockApiClient.GET).not.toHaveBeenCalled()
  })

  it('does not fetch when sessionId is missing', async () => {
    renderHook(() => useCandidateActions(undefined, undefined, true))
    await act(async () => {})

    expect(mockApiClient.GET).not.toHaveBeenCalled()
  })

  it('loads actions on mount', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: {
        success: true,
        actions: [
          { resumeId: 'r-1', actionType: 'star' },
          { resumeId: 'r-2', actionType: 'archive' },
        ],
      },
    })
    const { result } = renderHook(() => useCandidateActions('s-1'))
    await act(async () => {})

    expect(result.current.actionsByResume['r-1']).toBe('star')
    expect(result.current.actionsByResume['r-2']).toBe('archive')
  })

  it('extracts ratings from actions', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: {
        success: true,
        actions: [
          { resumeId: 'r-1', actionType: 'rating', actionData: { rating: 4 } },
        ],
      },
    })
    const { result } = renderHook(() => useCandidateActions('s-1'))
    await act(async () => {})

    expect(result.current.ratingsByResume['r-1']).toBe(4)
    expect(result.current.actionsByResume['r-1']).toBeUndefined()
  })

  it('skips zero ratings', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: {
        success: true,
        actions: [
          { resumeId: 'r-1', actionType: 'rating', actionData: { rating: 0 } },
        ],
      },
    })
    const { result } = renderHook(() => useCandidateActions('s-1'))
    await act(async () => {})

    expect(result.current.ratingsByResume['r-1']).toBeUndefined()
  })

  it('extracts AI feedback from actions', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: {
        success: true,
        actions: [
          { resumeId: 'r-1', actionType: 'ai_score_upvote' },
        ],
      },
    })
    const { result } = renderHook(() => useCandidateActions('s-1'))
    await act(async () => {})

    expect(result.current.aiFeedbackByResume['r-1']).toEqual({ score: 'positive' })
  })

  it('sets error on API failure', async () => {
    mockApiClient.GET.mockResolvedValueOnce({ data: { success: false } })
    const { result } = renderHook(() => useCandidateActions('s-1'))
    await act(async () => {})

    expect(result.current.error).toBe('Failed to load actions')
  })

  it('saveAction POSTs and returns action', async () => {
    mockApiClient.GET.mockResolvedValue({ data: { success: true, actions: [] } })
    mockApiClient.POST.mockResolvedValueOnce({
      data: { success: true, action: { resumeId: 'r-1', actionType: 'star' } },
    })

    const { result } = renderHook(() => useCandidateActions('s-1'))
    await act(async () => {})

    let action: unknown = null
    await act(async () => {
      action = await result.current.saveAction({ resumeId: 'r-1', actionType: 'star' })
    })

    expect(action).toEqual({ resumeId: 'r-1', actionType: 'star' })
    expect(mockApiClient.POST).toHaveBeenCalledWith('/api/actions', {
      body: { sessionId: 's-1', resumeId: 'r-1', actionType: 'star', actionData: undefined },
    })
  })

  it('saveAction returns null on failure', async () => {
    mockApiClient.GET.mockResolvedValue({ data: { success: true, actions: [] } })
    mockApiClient.POST.mockResolvedValueOnce({ data: { success: false } })

    const { result } = renderHook(() => useCandidateActions('s-1'))
    await act(async () => {})

    let action: unknown = undefined
    await act(async () => {
      action = await result.current.saveAction({ resumeId: 'r-1', actionType: 'star' })
    })

    expect(action).toBeNull()
    expect(result.current.error).toBe('Failed to save action')
  })

  it('getAiFeedback returns sentiment for known resume', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: {
        success: true,
        actions: [{ resumeId: 'r-1', actionType: 'ai_score_upvote' }],
      },
    })
    const { result } = renderHook(() => useCandidateActions('s-1'))
    await act(async () => {})

    expect(result.current.getAiFeedback('r-1', 'ai_score')).toBe('positive')
    expect(result.current.getAiFeedback('r-2', 'ai_score')).toBeUndefined()
  })

  it('clears state when disabled', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: { success: true, actions: [{ resumeId: 'r-1', actionType: 'star' }] },
    })
    const { result, rerender } = renderHook(
      (props: { enabled: boolean }) => useCandidateActions('s-1', undefined, props.enabled),
      { initialProps: { enabled: true } },
    )
    await act(async () => {})

    expect(result.current.actionsByResume['r-1']).toBe('star')

    rerender({ enabled: false })
    await act(async () => {})

    expect(result.current.actionsByResume).toEqual({})
  })
})
