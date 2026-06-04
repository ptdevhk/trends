import { describe, expect, it } from 'vitest'
import { parseRawSalaryRange, parseSalaryRange } from './salary'

describe('parseSalaryRange', () => {
  describe('null inputs', () => {
    it('returns null for undefined', () => {
      expect(parseSalaryRange(undefined)).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(parseSalaryRange('')).toBeNull()
    })

    it('returns null for 面议 (negotiable)', () => {
      expect(parseSalaryRange('面议')).toBeNull()
    })

    it('returns null for whitespace-only string', () => {
      expect(parseSalaryRange('   ')).toBeNull()
    })
  })

  describe('K-unit output (default)', () => {
    it('parses bare number range "8000-12000"', () => {
      expect(parseSalaryRange('8000-12000')).toEqual({ min: 8000, max: 12000 })
    })

    it('parses single bare number "15000"', () => {
      expect(parseSalaryRange('15000')).toEqual({ min: 15000, max: undefined })
    })

    it('parses K-range "15K-25K"', () => {
      expect(parseSalaryRange('15K-25K')).toEqual({ min: 15, max: 25 })
    })

    it('parses lowercase k-range "10k-20k"', () => {
      expect(parseSalaryRange('10k-20k')).toEqual({ min: 10, max: 20 })
    })

    it('parses 千-range "5千-8千"', () => {
      expect(parseSalaryRange('5千-8千')).toEqual({ min: 5, max: 8 })
    })

    it('parses 万-range "1万-2万"', () => {
      expect(parseSalaryRange('1万-2万')).toEqual({ min: 10, max: 20 })
    })

    it('parses single 万 value "15万/年"', () => {
      expect(parseSalaryRange('15万/年')).toEqual({ min: 150, max: undefined })
    })

    it('parses 万-range with period suffix "15-25万/年"', () => {
      expect(parseSalaryRange('15-25万/年')).toEqual({ min: 150, max: 250 })
    })

    it('parses decimal 万 "1.5-2.5万/年"', () => {
      expect(parseSalaryRange('1.5-2.5万/年')).toEqual({ min: 15, max: 25 })
    })

    it('parses salary with 元/月 suffix "12000-18000元/月"', () => {
      expect(parseSalaryRange('12000-18000元/月')).toEqual({ min: 12000, max: 18000 })
    })
  })

  describe('raw unit output', () => {
    it('converts K to raw CNY "15K-25K"', () => {
      expect(parseSalaryRange('15K-25K', { unit: 'raw' })).toEqual({ min: 15000, max: 25000 })
    })

    it('converts 千 to raw CNY "5千-8千"', () => {
      expect(parseSalaryRange('5千-8千', { unit: 'raw' })).toEqual({ min: 5000, max: 8000 })
    })

    it('converts 万 to raw CNY "1万-2万"', () => {
      expect(parseSalaryRange('1万-2万', { unit: 'raw' })).toEqual({ min: 10000, max: 20000 })
    })

    it('returns bare numbers as-is in raw mode', () => {
      expect(parseSalaryRange('8000-12000', { unit: 'raw' })).toEqual({ min: 8000, max: 12000 })
    })

    it('converts single K value to raw CNY', () => {
      expect(parseSalaryRange('20K', { unit: 'raw' })).toEqual({ min: 20000, max: undefined })
    })

    it('converts single 万 value to raw CNY', () => {
      expect(parseSalaryRange('1.5万', { unit: 'raw' })).toEqual({ min: 15000, max: undefined })
    })

    it('converts monthly decimal 万 ranges to raw CNY', () => {
      expect(parseSalaryRange('2.8-4.2万/月', { unit: 'raw' })).toEqual({ min: 28000, max: 42000 })
    })

    it('has an explicit raw-CNY helper', () => {
      expect(parseRawSalaryRange('2.8-4.2万/月')).toEqual({ min: 28000, max: 42000 })
    })
  })

  describe('separators', () => {
    it('parses tilde separator "10~20K"', () => {
      expect(parseSalaryRange('10~20K')).toEqual({ min: 10, max: 20 })
    })

    it('parses Chinese 到 separator "10到20K"', () => {
      expect(parseSalaryRange('10到20K')).toEqual({ min: 10, max: 20 })
    })

    it('parses Chinese 至 separator "10至20K"', () => {
      expect(parseSalaryRange('10至20K')).toEqual({ min: 10, max: 20 })
    })

    it('parses range with spaces "10 - 20K"', () => {
      expect(parseSalaryRange('10 - 20K')).toEqual({ min: 10, max: 20 })
    })
  })

  describe('edge cases', () => {
    it('parses decimal values "12.5-18.5"', () => {
      expect(parseSalaryRange('12.5-18.5')).toEqual({ min: 12.5, max: 18.5 })
    })

    it('returns null for non-numeric input', () => {
      expect(parseSalaryRange('abc')).toBeNull()
    })

    it('handles K with slash suffix "15K/月"', () => {
      expect(parseSalaryRange('15K/月')).toEqual({ min: 15, max: undefined })
    })
  })
})
