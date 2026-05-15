import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const mockSentryInit = vi.hoisted(() => vi.fn())
vi.mock('@sentry/react', () => ({
  init: mockSentryInit,
  browserTracingIntegration: () => ({ name: 'BrowserTracing' }),
}))

import { initSentry } from '@/lib/sentry'

describe('initSentry', () => {
  beforeEach(() => {
    mockSentryInit.mockClear()
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@sentry.io/project')
  })
  afterEach(() => { vi.unstubAllEnvs() })

  it('calls Sentry.init with DSN', () => {
    initSentry()
    expect(mockSentryInit).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://key@sentry.io/project' })
    )
  })

  it('configures 0.2 tracesSampleRate', () => {
    initSentry()
    expect(mockSentryInit).toHaveBeenCalledWith(
      expect.objectContaining({ tracesSampleRate: 0.2 })
    )
  })

  it('does nothing when no DSN configured', () => {
    vi.stubEnv('VITE_SENTRY_DSN', '')
    initSentry()
    expect(mockSentryInit).not.toHaveBeenCalled()
  })

  describe('beforeSend', () => {
    function getBeforeSend(): NonNullable<Parameters<typeof mockSentryInit>[0]['beforeSend']> {
      initSentry()
      return mockSentryInit.mock.calls[0][0].beforeSend
    }

    it('strips token from URL query params', () => {
      const beforeSend = getBeforeSend()
      const event = { request: { url: 'https://api.example.com/data?token=secret123&name=test' } }
      const result = beforeSend(event, {} as Record<string, never>)
      expect(result?.request?.url).toBe('https://api.example.com/data?name=test')
    })

    it('strips key from URL query params', () => {
      const beforeSend = getBeforeSend()
      const event = { request: { url: 'https://api.example.com/data?key=abc123&id=1' } }
      const result = beforeSend(event, {} as Record<string, never>)
      expect(result?.request?.url).toBe('https://api.example.com/data?id=1')
    })

    it('returns event unchanged when no URL', () => {
      const beforeSend = getBeforeSend()
      const event = { request: {} }
      const result = beforeSend(event, {} as Record<string, never>)
      expect(result).toBe(event)
    })

    it('returns event unchanged on invalid URL', () => {
      const beforeSend = getBeforeSend()
      const event = { request: { url: 'not-a-valid-url' } }
      const result = beforeSend(event, {} as Record<string, never>)
      expect(result).toBe(event)
    })
  })
})
