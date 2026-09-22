import { describe, expect, it } from 'vitest'
import {
  buildDailyReportThumbDataUri,
  buildDailyReportThumbSvg,
  chipGlyph,
  hashThumbSeed,
} from './daily-report-thumb'

describe('daily-report-thumb (dedicated)', () => {
  it('uses distinct light palettes per kind', () => {
    const kinds = ['商机', '转机', '动态', 'story'] as const
    const bgs = kinds.map((kind) => {
      const svg = buildDailyReportThumbSvg({ title: '数控', kind, chips: ['机床'] })
      const m = svg.match(/fill="(#[0-9a-fA-F]{6})"/)
      return m?.[1]
    })
    expect(new Set(bgs).size).toBe(kinds.length)
  })

  it('encodes as utf-8 data-uri usable in img src', () => {
    const uri = buildDailyReportThumbDataUri({
      title: '海克斯康 三坐标',
      kind: '动态',
      chips: ['三坐标', 'CMM'],
    })
    expect(uri).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    const decoded = decodeURIComponent(uri.slice('data:image/svg+xml;charset=utf-8,'.length))
    expect(decoded).toContain('三坐标')
    expect(decoded).toContain('CMM')
  })

  it('is stable across calls', () => {
    const input = { title: '乔锋扩产', kind: '商机' as const, chips: ['乔锋'] }
    expect(buildDailyReportThumbSvg(input)).toBe(buildDailyReportThumbSvg(input))
    expect(hashThumbSeed(input.title)).toBe(hashThumbSeed(input.title))
  })

  it('chipGlyph caps length', () => {
    expect(chipGlyph('')).toBe('')
    expect([...chipGlyph('abcdefghijk', 6)].length).toBeLessThanOrEqual(6)
  })
})
