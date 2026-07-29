import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useSettingsRequestJson } from './lib'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useSettingsRequestJson', () => {
  it('includes credentials so authenticated settings requests work with a configured API origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSettingsRequestJson())
    await act(async () => {
      await result.current.requestJson('/api/company-industry-proposals')
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/company-industry-proposals'),
      expect.objectContaining({ credentials: 'include' }),
    )
  })
})
