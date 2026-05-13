import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { CandidateAction } from '@/types/resume'
import { useCandidateActions } from './useCandidateActions'

type ApiActionResponse = { data: { success: boolean; actions?: CandidateAction[] } }
type ApiPostResponse = { data: { success: boolean; action?: CandidateAction } }

const mockApiClient = vi.hoisted(() => ({
  GET: vi.fn(async (): Promise<ApiActionResponse> => ({
    data: {
      success: true,
      actions: [],
    },
  })),
  POST: vi.fn(async (): Promise<ApiPostResponse> => ({
    data: {
      success: true,
      action: { id: 1, resumeId: 'r-1', actionType: 'star' as const, createdAt: '2026-01-01' },
    },
  })),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: mockApiClient,
}))

describe('useCandidateActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads and separates regular actions from AI feedback actions', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: {
        success: true,
        actions: [
          { id: 1, resumeId: 'r-1', actionType: 'star' as const, createdAt: '2026-01-01' },
          { id: 2, resumeId: 'r-1', actionType: 'ai_score_like' as const, createdAt: '2026-01-01' },
          { id: 3, resumeId: 'r-2', actionType: 'ai_summary_unlike' as const, createdAt: '2026-01-01' },
        ],
      },
    })

    const { result } = renderHook(() => useCandidateActions('session-1'))
    await act(async () => {})

    expect(result.current.actions).toEqual({ 'r-1': 'star' })
    expect(result.current.getAiFeedback('r-1', 'ai_score')).toBe('like')
    expect(result.current.getAiFeedback('r-2', 'ai_summary')).toBe('unlike')
    expect(result.current.getAiFeedback('r-1', 'ai_summary')).toBeUndefined()
  })

  it('saves AI feedback and updates local state', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: {
        success: true,
        actions: [],
      },
    })
    mockApiClient.POST.mockResolvedValueOnce({
      data: {
        success: true,
        action: { id: 10, resumeId: 'r-1', actionType: 'ai_score_like' as const, createdAt: '2026-01-01' },
      },
    })

    const { result } = renderHook(() => useCandidateActions('session-1'))
    await act(async () => {})

    await act(async () => {
      await result.current.saveAction({
        resumeId: 'r-1',
        actionType: 'ai_score_like',
      })
    })

    expect(result.current.getAiFeedback('r-1', 'ai_score')).toBe('like')
    expect(result.current.actions['r-1']).toBeUndefined()
  })

  it('saves regular actions without affecting AI feedback', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: {
        success: true,
        actions: [],
      },
    })
    mockApiClient.POST.mockResolvedValueOnce({
      data: {
        success: true,
        action: { id: 11, resumeId: 'r-1', actionType: 'shortlist' as const, createdAt: '2026-01-01' },
      },
    })

    const { result } = renderHook(() => useCandidateActions('session-1'))
    await act(async () => {})

    await act(async () => {
      await result.current.saveAction({
        resumeId: 'r-1',
        actionType: 'shortlist',
      })
    })

    expect(result.current.actions['r-1']).toBe('shortlist')
  })

  it('clears all state when sessionId becomes undefined', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: {
        success: true,
        actions: [
          { id: 1, resumeId: 'r-1', actionType: 'star' as const, createdAt: '2026-01-01' },
          { id: 2, resumeId: 'r-1', actionType: 'ai_score_like' as const, createdAt: '2026-01-01' },
        ],
      },
    })

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string | undefined }) => useCandidateActions(sessionId),
      { initialProps: { sessionId: 'session-1' as string | undefined } }
    )

    await act(async () => {})

    expect(result.current.actions['r-1']).toBe('star')
    expect(result.current.getAiFeedback('r-1', 'ai_score')).toBe('like')

    rerender({ sessionId: undefined })

    expect(result.current.actions).toEqual({})
    expect(result.current.getAiFeedback('r-1', 'ai_score')).toBeUndefined()
  })
})
