import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCreateClient = vi.hoisted(() => {
  const use = vi.fn()
  return { use, client: vi.fn(() => ({ use })) }
})

vi.mock('openapi-fetch', () => ({ default: mockCreateClient.client }))

import './api-client'

describe('api-client', () => {
  beforeEach(() => {
    document.cookie = 'trends_csrf=; Max-Age=0; path=/'
  })

  it('creates client with api base URL', () => {
    expect(mockCreateClient.client).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: expect.any(String), credentials: 'include' })
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

  it('middleware adds csrf header to mutating requests from csrf cookie', () => {
    document.cookie = 'trends_csrf=csrf-token-1; path=/'
    const middleware = mockCreateClient.use.mock.calls[0][0]
    const request = new Request('http://localhost/test', { method: 'POST' })

    middleware.onRequest({ request })

    expect(request.headers.get('X-CSRF-Token')).toBe('csrf-token-1')
  })

  it('middleware does not add csrf header to read requests', () => {
    document.cookie = 'trends_csrf=csrf-token-1; path=/'
    const middleware = mockCreateClient.use.mock.calls[0][0]
    const request = new Request('http://localhost/test', { method: 'GET' })

    middleware.onRequest({ request })

    expect(request.headers.get('X-CSRF-Token')).toBeNull()
  })
})
