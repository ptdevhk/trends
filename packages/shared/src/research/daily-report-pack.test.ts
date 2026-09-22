import { describe, expect, it } from 'vitest'
import {
  isDailyReportPack,
  parseDailyReportPack,
  isPackBelowThreshold,
  type DailyReportPack,
} from './daily-report-pack'

const validPack: DailyReportPack = {
  date: '2026-09-22',
  localeDefault: 'zh-Hans',
  source: 'live',
  generatedAt: '2026-09-22T08:00:00Z',
  hero: {
    headline: '今日商机热度',
    value: '37',
    delta: '+12%',
    meta: '3 行业 · 8 新公司',
    sparkline: [30, 25, 27, 16, 10, 14, 7, 4],
  },
  opportunities: [
    {
      kind: '商机',
      label: '3D 扫描 销售',
      heat: '3.8万',
      growth: '+1,200%',
      started: 't1',
      sparkline: [26, 21, 23, 14, 9, 12, 6, 5],
      chips: ['三坐标测量机', '工业测量'],
    },
    {
      kind: '商机',
      label: 'CNC 编程',
      heat: '2.9万',
      growth: '+850%',
      started: 't2',
      sparkline: [28, 24, 25, 18, 15, 12, 12, 12],
      chips: ['数控编程', '江苏'],
    },
    {
      kind: '转机',
      label: '数控机床 订单',
      heat: '1.6万',
      growth: '+540%',
      started: 't3',
      sparkline: [24, 21, 22, 16, 17, 15, 15, 15],
      chips: ['订单回暖', '长三角'],
    },
  ],
  stories: [
    { title: '数控机床订单回暖' },
    { title: '长三角招工潮', imageUrl: 'https://example.com/c.png' },
  ],
}

describe('isDailyReportPack', () => {
  it('accepts a valid pack', () => {
    expect(isDailyReportPack(validPack)).toBe(true)
  })

  it('returns false for undefined / null / non-object', () => {
    expect(isDailyReportPack(undefined)).toBe(false)
    expect(isDailyReportPack(null)).toBe(false)
    expect(isDailyReportPack('nope')).toBe(false)
  })

  it('accepts frozen source (hybrid fallback)', () => {
    expect(isDailyReportPack({ ...validPack, source: 'frozen' })).toBe(true)
  })

  it('rejects unknown source', () => {
    expect(isDailyReportPack({ ...validPack, source: 'bogus' })).toBe(false)
  })

  it('rejects wrong localeDefault', () => {
    expect(isDailyReportPack({ ...validPack, localeDefault: 'en' })).toBe(false)
  })

  it('rejects a non-array sparkline', () => {
    const bad: unknown = { ...validPack, hero: { ...validPack.hero, sparkline: 'not-an-array' } }
    expect(isDailyReportPack(bad)).toBe(false)
  })

  it('rejects an invalid opportunity kind', () => {
    const bad: unknown = structuredClone(validPack) as DailyReportPack
    ;(bad as DailyReportPack).opportunities[0].kind = '其他' as never
    expect(isDailyReportPack(bad)).toBe(false)
  })

  it('rejects a missing label', () => {
    const src = structuredClone(validPack)
    const { label: _omit, ...rest } = src.opportunities[0]
    const bad: unknown = {
      ...src,
      opportunities: [rest, src.opportunities[1], src.opportunities[2]],
    }
    expect(isDailyReportPack(bad)).toBe(false)
  })

  it('accepts opportunities without chips/href/imageUrl', () => {
    const lean = structuredClone(validPack)
    lean.opportunities[1].chips = undefined
    lean.opportunities[1].imageUrl = undefined
    expect(isDailyReportPack(lean)).toBe(true)
  })

  it('accepts fallbackFromDate on frozen pack', () => {
    expect(isDailyReportPack({ ...validPack, source: 'frozen', fallbackFromDate: '2026-09-21' })).toBe(true)
  })
})

describe('parseDailyReportPack', () => {
  it('returns the pack unchanged when valid', () => {
    expect(parseDailyReportPack(validPack)).toBe(validPack)
  })

  it('throws on invalid input', () => {
    expect(() => parseDailyReportPack({ date: 1 })).toThrow('Invalid DailyReportPack')
  })
})

describe('isPackBelowThreshold', () => {
  it('detects a below-minimum pack (hybrid fallback)', () => {
    const thin = { ...validPack, opportunities: validPack.opportunities.slice(0, 1), stories: [] }
    expect(isPackBelowThreshold(thin, 4)).toBe(true)
  })

  it('passes an adequate pack', () => {
    expect(isPackBelowThreshold(validPack, 4)).toBe(false)
  })
})
