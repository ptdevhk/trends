import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useAuditLogs, useBiasReport } from './useAuditLogs'

type AuditLogEntry = {
  _id: string
  resumeId: string
  workspaceSlug: string
  decisionType: 'score' | 'tag' | 'rank' | 'filter' | 'confirm'
  actionRef: string
  inputSnapshot: Record<string, unknown>
  modelMeta: { model: string; provider: string }
  output: Record<string, unknown>
  decidedAt: number
  expiresAt: number
}

const mockApiClient = vi.hoisted(() => ({
  GET: vi.fn(async () => ({ data: { success: true } as Record<string, unknown> })),
  POST: vi.fn(async () => ({ data: { success: true } as Record<string, unknown> })),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: mockApiClient,
}))

describe('useAuditLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads audit logs on mount when enabled', async () => {
    const mockLogs: AuditLogEntry[] = [
      {
        _id: 'al1',
        resumeId: 'r1',
        workspaceSlug: 'ws',
        decisionType: 'score',
        actionRef: 'analyze:analyzeResume',
        inputSnapshot: {},
        modelMeta: { model: 'gpt-4', provider: 'openai' },
        output: { score: 85 },
        decidedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
      },
    ]
    mockApiClient.POST.mockResolvedValueOnce({
      data: { success: true, data: mockLogs },
    })

    const { result } = renderHook(() => useAuditLogs('ws', true))
    await act(async () => {})

    expect(result.current.logs).toHaveLength(1)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('does not fetch when disabled', async () => {
    const { result } = renderHook(() => useAuditLogs('ws', false))
    await act(async () => {})

    expect(mockApiClient.POST).not.toHaveBeenCalled()
    expect(result.current.logs).toEqual([])
  })

  it('does not fetch when workspace slug is empty', async () => {
    renderHook(() => useAuditLogs('', true))
    await act(async () => {})

    expect(mockApiClient.POST).not.toHaveBeenCalled()
  })

  it('sends filters in request body', async () => {
    mockApiClient.POST.mockResolvedValueOnce({
      data: { success: true, data: [] },
    })

    const { result } = renderHook(() => useAuditLogs('ws', true))
    await act(async () => {})

    await act(async () => {
      result.current.setFilters({ decisionType: 'score' })
    })

    expect(mockApiClient.POST).toHaveBeenCalledWith(
      '/api/resumes/audit-logs',
      expect.objectContaining({
        body: expect.objectContaining({ workspaceSlug: 'ws', decisionType: 'score' }),
      }),
    )
  })

  it('sets error when API fails', async () => {
    mockApiClient.POST.mockResolvedValueOnce({
      data: { success: false, error: 'Server error' },
    })

    const { result } = renderHook(() => useAuditLogs('ws', true))
    await act(async () => {})

    expect(result.current.error).toBe('Server error')
  })

  it('setOutcome POSTs and reloads logs', async () => {
    mockApiClient.POST
      .mockResolvedValueOnce({ data: { success: true, data: [] } }) // initial load
      .mockResolvedValueOnce({ data: { success: true } }) // setOutcome
      .mockResolvedValueOnce({ data: { success: true, data: [] } }) // reload

    const { result } = renderHook(() => useAuditLogs('ws', true))
    await act(async () => {})

    let success = false
    await act(async () => {
      success = await result.current.setOutcome('al1', 'overridden', 'reviewer@example.com')
    })

    expect(success).toBe(true)
    expect(mockApiClient.POST).toHaveBeenCalledWith(
      '/api/resumes/audit-outcome',
      expect.objectContaining({
        body: { auditLogId: 'al1', outcome: 'overridden', setBy: 'reviewer@example.com' },
      }),
    )
  })

  it('setOutcome returns false on API failure', async () => {
    mockApiClient.POST
      .mockResolvedValueOnce({ data: { success: true, data: [] } }) // initial load
      .mockResolvedValueOnce({ data: { success: false, error: 'Not found' } }) // setOutcome fails

    const { result } = renderHook(() => useAuditLogs('ws', true))
    await act(async () => {})

    let success = true
    await act(async () => {
      success = await result.current.setOutcome('al1', 'overridden')
    })

    expect(success).toBe(false)
  })
})

describe('useBiasReport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads bias report on mount when enabled', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: {
        success: true,
        report: { generatedAt: Date.now(), workspaceSlug: 'ws', anomalyDetected: false },
      },
    })

    const { result } = renderHook(() => useBiasReport('ws', true))
    await act(async () => {})

    expect(result.current.report).toBeDefined()
    expect(result.current.loading).toBe(false)
  })

  it('does not fetch when disabled', async () => {
    const { result } = renderHook(() => useBiasReport('ws', false))
    await act(async () => {})

    expect(mockApiClient.GET).not.toHaveBeenCalled()
    expect(result.current.report).toBeNull()
  })

  it('sets error when API fails', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: { success: false, error: 'Unauthorized' },
    })

    const { result } = renderHook(() => useBiasReport('ws', true))
    await act(async () => {})

    expect(result.current.error).toBe('Unauthorized')
  })

  it('returns null report when no report available', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: { success: true, report: null },
    })

    const { result } = renderHook(() => useBiasReport('ws', true))
    await act(async () => {})

    expect(result.current.report).toBeNull()
  })
})
