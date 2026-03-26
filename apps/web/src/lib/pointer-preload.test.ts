import { describe, expect, it } from 'vitest'

import { shouldPreloadOnPointerDown } from './pointer-preload'

describe('shouldPreloadOnPointerDown', () => {
  it('preloads for touch-first pointer types', () => {
    expect(shouldPreloadOnPointerDown('touch')).toBe(true)
    expect(shouldPreloadOnPointerDown('pen')).toBe(true)
    expect(shouldPreloadOnPointerDown(' Touch ')).toBe(true)
  })

  it('skips desktop hover-first pointer types', () => {
    expect(shouldPreloadOnPointerDown('mouse')).toBe(false)
    expect(shouldPreloadOnPointerDown(undefined)).toBe(false)
    expect(shouldPreloadOnPointerDown('')).toBe(false)
  })
})
