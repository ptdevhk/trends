import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchExtensionMetaJson } from './external-fetch'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchExtensionMetaJson', () => {
  it('returns the parsed extension metadata JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: '1.2.3' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    await expect(fetchExtensionMetaJson()).resolves.toEqual({ version: '1.2.3' })
  })

  it('returns null when the metadata asset is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('{}', { status: 404 }),
    ))

    await expect(fetchExtensionMetaJson()).resolves.toBeNull()
  })

  it('propagates network failures to the caller', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    await expect(fetchExtensionMetaJson()).rejects.toThrow('network down')
  })
})
