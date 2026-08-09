import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const getMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    GET: (...args: unknown[]) => getMock(...args),
  },
}))

import { useSystemMetadata } from './useSystemMetadata'

describe('useSystemMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null initially', () => {
    getMock.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useSystemMetadata())
    expect(result.current).toBeNull()
  })

  it('fetches and returns metadata on success', async () => {
    const metadata = {
      identity: { appVersion: '1.0.0' },
      navigation: { system: [], settings: [], systemSettings: [], debugPage: [] },
    }
    getMock.mockResolvedValueOnce({
      data: { success: true, metadata },
      response: { ok: true, status: 200 },
    })
    const { result } = renderHook(() => useSystemMetadata())
    await waitFor(() => { expect(result.current).not.toBeNull() })
    expect(result.current?.identity.appVersion).toBe('1.0.0')
  })

  it('fetches from the correct endpoint through the shared api client', async () => {
    getMock.mockResolvedValueOnce({
      data: { success: true, metadata: { identity: { appVersion: '1' }, navigation: {} } },
      response: { ok: true, status: 200 },
    })
    renderHook(() => useSystemMetadata())
    await waitFor(() => { expect(getMock).toHaveBeenCalled() })
    expect(getMock).toHaveBeenCalledWith('/api/config/system-metadata')
  })

  it('handles HTTP error gracefully', async () => {
    getMock.mockResolvedValueOnce({ data: undefined, response: { ok: false, status: 500 } })
    const { result } = renderHook(() => useSystemMetadata())
    await waitFor(() => { expect(getMock).toHaveBeenCalled() })
    expect(result.current).toBeNull()
  })

  it('handles network error gracefully', async () => {
    getMock.mockRejectedValueOnce(new Error('network'))
    const { result } = renderHook(() => useSystemMetadata())
    await waitFor(() => { expect(getMock).toHaveBeenCalled() })
    expect(result.current).toBeNull()
  })
})
