import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { useSystemMetadata } from './useSystemMetadata'

vi.mock('@/lib/workspace-ref', () => ({
  withWorkspaceHeaders: () => ({ 'x-workspace': 'test' }),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('useSystemMetadata', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null initially', () => {
    mockFetch.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useSystemMetadata())
    expect(result.current).toBeNull()
  })

  it('fetches and returns metadata on success', async () => {
    const metadata = {
      identity: { appVersion: '1.0.0' },
      navigation: { system: [], settings: [], systemSettings: [], debugPage: [] },
    }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, metadata }),
    })
    const { result } = renderHook(() => useSystemMetadata())
    await waitFor(() => { expect(result.current).not.toBeNull() })
    expect(result.current?.identity.appVersion).toBe('1.0.0')
  })

  it('fetches from correct endpoint with workspace headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, metadata: { identity: { appVersion: '1' }, navigation: {} } }),
    })
    renderHook(() => useSystemMetadata())
    await waitFor(() => { expect(mockFetch).toHaveBeenCalled() })
    expect(mockFetch).toHaveBeenCalledWith('/api/config/system-metadata', {
      headers: { 'x-workspace': 'test' },
    })
  })

  it('handles HTTP error gracefully', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    const { result } = renderHook(() => useSystemMetadata())
    await waitFor(() => { expect(mockFetch).toHaveBeenCalled() })
    expect(result.current).toBeNull()
  })

  it('handles network error gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'))
    const { result } = renderHook(() => useSystemMetadata())
    await waitFor(() => { expect(mockFetch).toHaveBeenCalled() })
    expect(result.current).toBeNull()
  })
})
