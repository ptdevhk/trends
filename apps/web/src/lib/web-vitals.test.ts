import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockOnLCP = vi.hoisted(() => vi.fn())
const mockOnCLS = vi.hoisted(() => vi.fn())
const mockOnINP = vi.hoisted(() => vi.fn())
const mockOnFCP = vi.hoisted(() => vi.fn())
const mockOnTTFB = vi.hoisted(() => vi.fn())

vi.mock('web-vitals', () => ({
  onLCP: mockOnLCP,
  onCLS: mockOnCLS,
  onINP: mockOnINP,
  onFCP: mockOnFCP,
  onTTFB: mockOnTTFB,
}))

import { initWebVitals } from '@/lib/web-vitals'

describe('initWebVitals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers all five metric observers', () => {
    initWebVitals()
    expect(mockOnLCP).toHaveBeenCalled()
    expect(mockOnCLS).toHaveBeenCalled()
    expect(mockOnINP).toHaveBeenCalled()
    expect(mockOnFCP).toHaveBeenCalled()
    expect(mockOnTTFB).toHaveBeenCalled()
  })

  it('reports metric on LCP callback', () => {
    initWebVitals()
    const callback = mockOnLCP.mock.calls[0][0]
    const metric = { name: 'LCP', value: 2500, rating: 'needs-improvement', id: 'm1', navigationType: 'navigate' }
    // Should not throw when called
    expect(() => callback(metric)).not.toThrow()
  })
})
