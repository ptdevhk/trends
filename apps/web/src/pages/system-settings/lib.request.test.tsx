import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SettingsRequestError, useSettingsRequestJson } from './lib'

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

  it('throws SettingsRequestError with the status and parsed failure body', async () => {
    const failureBody = {
      success: false,
      code: 'INDUSTRY_REVIEW_STALE',
      error: 'The review packet is stale.',
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(failureBody), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSettingsRequestJson())
    let thrown: unknown
    await act(async () => {
      try {
        await result.current.requestJson('/api/company-industry-proposals/proposal-1/approve', {
          method: 'POST',
        })
      } catch (error) {
        thrown = error
      }
    })

    expect(thrown).toBeInstanceOf(SettingsRequestError)
    expect(thrown).toMatchObject({
      name: 'SettingsRequestError',
      message: 'HTTP 409',
      status: 409,
      body: failureBody,
    })
  })
})
