import { describe, expect, it } from 'vitest'
import {
  resolveLocationHierarchy,
  isLocationMatch,
} from './location-tree'

describe('short Latin alias word boundaries (PR #1130 regression)', () => {
  describe('positive matches — short Latin aliases with word boundaries', () => {
    it('matches "Shenzhen, CN" → China', () => {
      const result = resolveLocationHierarchy('Shenzhen, CN')
      expect(result).toBeDefined()
      expect(result?.country).toBe('中国')
    })

    it('matches "CN" alone → China', () => {
      const result = resolveLocationHierarchy('CN')
      expect(result).toBeDefined()
      expect(result?.country).toBe('中国')
    })

    it('matches "China" (full word, >3 chars) → China', () => {
      const result = resolveLocationHierarchy('China')
      expect(result).toBeDefined()
      expect(result?.country).toBe('中国')
    })

    it('matches "MY" alone → Malaysia', () => {
      const result = resolveLocationHierarchy('MY')
      expect(result).toBeDefined()
      expect(result?.country).toBe('Malaysia')
    })
  })

  describe('negative matches — short Latin substrings must NOT match', () => {
    it('does NOT match "CNC Metal Machining" → China', () => {
      const result = resolveLocationHierarchy('CNC Metal Machining')
      expect(result?.country).not.toBe('中国')
    })

    it('does NOT match "CNCom Pty Ltd" → China', () => {
      const result = resolveLocationHierarchy('CNCom Pty Ltd')
      expect(result?.country).not.toBe('中国')
    })

    it('does NOT match "HKEY LOCAL MACHINE" → Hong Kong', () => {
      // HK is not a standalone location in the tree; "HKEY" must not resolve to any location
      const result = resolveLocationHierarchy('HKEY LOCAL MACHINE')
      expect(result).toBeUndefined()
    })

    it('does NOT match "MYSQL database admin" → Malaysia', () => {
      const result = resolveLocationHierarchy('MYSQL database admin')
      expect(result?.country).not.toBe('Malaysia')
    })
  })

  describe('CJK aliases still substring-match', () => {
    it('matches "广东省深圳市" → China (CJK substring is unambiguous)', () => {
      const result = resolveLocationHierarchy('广东省深圳市')
      expect(result).toBeDefined()
      expect(result?.country).toBe('中国')
    })

    it('matches "中国大陆" → China', () => {
      const result = resolveLocationHierarchy('中国大陆')
      expect(result).toBeDefined()
      expect(result?.country).toBe('中国')
    })
  })

  describe('isLocationMatch — filter path behavior', () => {
    it('CNC role in China location matches "China" filter', () => {
      expect(isLocationMatch('Shenzhen, China', 'China')).toBe(true)
    })

    it('CNC role text in non-China location does NOT match "China" filter', () => {
      expect(isLocationMatch('Kuala Lumpur, Malaysia', 'China')).toBe(false)
    })

    it('location with "CN" abbreviation matches "China" filter', () => {
      expect(isLocationMatch('Shenzhen, CN', 'China')).toBe(true)
    })

    it('"CNC" in role text does NOT cause China location match', () => {
      // This is the core regression: "CNC" should not match "CN" alias
      expect(isLocationMatch('CNC Metal Machining, Kuala Lumpur', 'China')).toBe(false)
    })
  })
})
