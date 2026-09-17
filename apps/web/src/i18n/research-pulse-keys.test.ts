import { describe, expect, it } from 'vitest'

import en from './locales/en.json'
import zhHans from './locales/zh-Hans.json'
import zhHant from './locales/zh-Hant.json'

const LOCALES: Record<string, Record<string, unknown>> = {
  en,
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
}

function lookupPath(root: Record<string, unknown>, path: string): unknown {
  let current: unknown = root
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

const PULSE_KEYWORDS_PATH = 'research.pulseKeywords'

const PULSE_KEYWORDS_KEYS = [
  'addCustom',
  'clearFocus',
  'collapseChips',
  'customDuplicate',
  'customMax',
  'customPlaceholder',
  'customSection',
  'customTooLong',
  'defaultsSection',
  'dialogDescription',
  'dialogTitle',
  'helperCollapse',
  'helperExpand',
  'helperHitCount',
  'helperSummaryAll',
  'helperSummaryFiltered',
  'helperZero',
  'manage',
  'removeCustom',
  'save',
  'saving',
  'showAll',
  'softEmpty',
  'softEmptyRss',
  'chipDualCount',
  'sourceRss',
]

/** Han ideographs (CJK Unified Ideographs, the BMP block locales actually use). */
const HAN = /[一-鿿]/

/**
 * Keys whose copy is intentionally identical across zh-Hans and zh-Hant — either a
 * locale-neutral acronym (`sourceRss` = "RSS") or a word whose Simplified and
 * Traditional forms genuinely coincide (Add / Show less / Remove / Save / Saving…).
 */
const LOCALE_NEUTRAL_KEYS = new Set(['sourceRss'])

const HANS_HANT_SHARED_KEYS = new Set([
  'addCustom',
  'collapseChips',
  'removeCustom',
  'save',
  'saving',
])

/** Keys expected to differ between zh-Hans and zh-Hant after the Traditional pass. */
const HANS_HANT_DIFFERING_KEYS = PULSE_KEYWORDS_KEYS.filter(
  (key) => !LOCALE_NEUTRAL_KEYS.has(key) && !HANS_HANT_SHARED_KEYS.has(key),
)

function pulseBlock(locale: Record<string, unknown>): Record<string, string> {
  const block = lookupPath(locale, PULSE_KEYWORDS_PATH)
  if (typeof block !== 'object' || block === null) {
    throw new Error(`${PULSE_KEYWORDS_PATH} missing in locale`)
  }
  return block as Record<string, string>
}

describe('research pulseKeywords i18n keys', () => {
  it('resolves every pulseKeywords copy key to a non-empty string in all three locales', () => {
    const missing: string[] = []
    for (const [localeName, locale] of Object.entries(LOCALES)) {
      const block = pulseBlock(locale)
      for (const key of PULSE_KEYWORDS_KEYS) {
        const value = block[key]
        if (typeof value !== 'string' || value.trim() === '') {
          missing.push(`${PULSE_KEYWORDS_PATH}.${key} (${localeName})`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('keeps all three locales on the same pulseKeywords key set', () => {
    const expected = [...PULSE_KEYWORDS_KEYS].sort()
    for (const [localeName, locale] of Object.entries(LOCALES)) {
      const keys = Object.keys(pulseBlock(locale)).sort()
      expect(keys, `${localeName} pulseKeywords keys`).toEqual(expected)
    }
  })

  it('en pulseKeywords copy is real English, not Chinese', () => {
    const enBlock = pulseBlock(LOCALES.en!)
    const stillChinese = Object.entries(enBlock)
      .filter(([, value]) => HAN.test(value))
      .map(([key]) => key)
    expect(stillChinese).toEqual([])
  })

  it('en chipDualCount says subscription, not feed', () => {
    const enBlock = pulseBlock(LOCALES.en!)
    expect(enBlock.chipDualCount).toBe('hotlist {{hotlist}} · subscription {{rss}}')
    expect(enBlock.chipDualCount).toContain('subscription')
    expect(enBlock.chipDualCount).not.toContain('feed')
  })

  it('zh-Hant pulse copy is Traditional, not Simplified', () => {
    const hant = pulseBlock(LOCALES['zh-Hant']!)
    // Pairs of Simplified-only glyphs that must not survive in the Traditional
    // locale. Each left-hand form is Simplified-specific; its Traditional
    // counterpart is listed on the right (e.g. 筛 -> 篩, 词 -> 詞, 订阅 -> 訂閱).
    const simplifiedGlyphs = ['筛', '词', '订', '阅', '关', '过', '热', '显', '页', '优', '据', '数', '线', '题', '证']
    const simplified = Object.entries(hant)
      .filter(([key]) => !LOCALE_NEUTRAL_KEYS.has(key))
      .filter(([, value]) => simplifiedGlyphs.some((glyph) => value.includes(glyph)))
      .map(([key, value]) => `${key}=${value}`)
    expect(simplified).toEqual([])

    expect(hant.chipDualCount).toBe('熱榜 {{hotlist}} · 訂閱 {{rss}}')
    expect(hant.softEmpty).toContain('當前關鍵詞')
    expect(hant.showAll).toBe('查看未過濾熱榜')
    expect(hant.helperHitCount).toBe('命中 {{hitCount}} 條')
  })

  it('en differs from zh-Hans for the touched pulse copy keys', () => {
    const enBlock = pulseBlock(LOCALES.en!)
    const hansBlock = pulseBlock(LOCALES['zh-Hans']!)
    const identical = PULSE_KEYWORDS_KEYS.filter(
      (key) => !LOCALE_NEUTRAL_KEYS.has(key) && enBlock[key] === hansBlock[key],
    )
    expect(identical).toEqual([])
  })

  it('zh-Hant differs from zh-Hans for the touched pulse copy keys', () => {
    const hansBlock = pulseBlock(LOCALES['zh-Hans']!)
    const hantBlock = pulseBlock(LOCALES['zh-Hant']!)
    const identical = HANS_HANT_DIFFERING_KEYS.filter(
      (key) => hansBlock[key] === hantBlock[key],
    )
    expect(identical).toEqual([])
  })

  it('keeps chipDualCount interpolation placeholders in every locale', () => {
    for (const [localeName, locale] of Object.entries(LOCALES)) {
      const value = pulseBlock(locale).chipDualCount
      expect(value, `${localeName} chipDualCount`).toContain('{{hotlist}}')
      expect(value, `${localeName} chipDualCount`).toContain('{{rss}}')
    }
  })

  it('keeps softEmptyRss mentioning both subscription sources in every locale', () => {
    for (const [localeName, locale] of Object.entries(LOCALES)) {
      const value = pulseBlock(locale).softEmptyRss
      expect(value, `${localeName} softEmptyRss`).toContain('Google News')
      expect(value, `${localeName} softEmptyRss`).toMatch(/RSS/)
    }
  })
})
