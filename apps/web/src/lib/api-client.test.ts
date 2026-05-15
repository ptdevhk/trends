import { describe, expect, it, vi } from 'vitest'

const mockCreateClient = vi.hoisted(() => {
  const use = vi.fn()
  return { use, client: vi.fn(() => ({ use })) }
})

vi.mock('openapi-fetch', () => ({ default: mockCreateClient.client }))

import './api-client'

describe('api-client', () => {
  it('creates client with api base URL', () => {
    expect(mockCreateClient.client).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: expect.any(String) })
    )
  })

  it('registers request middleware', () => {
    expect(mockCreateClient.use).toHaveBeenCalled()
  })

  it('middleware sets workspace header', () => {
    const middleware = mockCreateClient.use.mock.calls[0][0]
    expect(middleware.onRequest).toBeDefined()
    const headers = new Headers()
    const request = new Request('http://localhost/test', { headers })
    middleware.onRequest({ request })
    expect(request.headers.get('X-Workspace-Slug')).toBe('dev')
  })
})
