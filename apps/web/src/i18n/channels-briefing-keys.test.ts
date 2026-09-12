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

const CHANNELS_BRIEFING_KEYS = [
  'research.channelsBriefing.title',
  'research.channelsBriefing.description',
  'research.channelsBriefing.pasteLabel',
  'research.channelsBriefing.pastePlaceholder',
  'research.channelsBriefing.howToTitle',
  'research.channelsBriefing.howTo1',
  'research.channelsBriefing.howTo2',
  'research.channelsBriefing.howTo3',
  'research.channelsBriefing.tryExample',
  'research.channelsBriefing.generate',
  'research.channelsBriefing.generating',
  'research.channelsBriefing.empty',
  'research.channelsBriefing.error400',
  'research.channelsBriefing.error502',
  'research.channelsBriefing.errorGeneric',
  'research.channelsBriefing.retry',
  'research.channelsBriefing.sampleConnectorCategory',
  'research.channelsBriefing.sampleConnectorTitle',
  'research.channelsBriefing.sampleDieCastCategory',
  'research.channelsBriefing.sampleDieCastTitle',
  'research.channelsBriefing.sampleExpansionCategory',
  'research.channelsBriefing.sampleExpansionTitle',
  'research.channelsBriefing.samplePrimaryCategory',
  'research.channelsBriefing.samplePrimaryTitle',
  'research.channelsBriefing.samplesTitle',
  'research.channelsBriefing.oneLiner',
  'research.channelsBriefing.postsTitle',
  'research.channelsBriefing.postCount',
  'research.channelsBriefing.postMeta',
  'research.channelsBriefing.generatedAt',
  'research.channelsBriefing.sourceLabel',
  'research.channelsBriefing.coreTrends',
  'research.channelsBriefing.weakSignals',
  'research.channelsBriefing.opportunities',
  'research.channelsBriefing.colWho',
  'research.channelsBriefing.colSell',
  'research.channelsBriefing.colWhy',
  'research.channelsBriefing.sources',
  'research.channelsBriefing.coverAlt',
  'research.channelsBriefing.updateBriefing',
  'research.channelsBriefing.researchTopic',
  'research.channelsBriefing.findCandidates',
]

describe('channels briefing i18n keys', () => {
  it('resolves every channels briefing copy key to a non-empty string in all locales', () => {
    const missing: string[] = []
    for (const key of CHANNELS_BRIEFING_KEYS) {
      for (const [localeName, locale] of Object.entries(LOCALES)) {
        const value = lookupPath(locale, key)
        if (typeof value !== 'string' || value.trim() === '') {
          missing.push(`${key} (${localeName})`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('keeps audience-neutral section titles in zh-Hans', () => {
    expect(lookupPath(LOCALES['zh-Hans'], 'research.channelsBriefing.oneLiner')).toBe(
      '今日要点',
    )
    expect(lookupPath(LOCALES['zh-Hans'], 'research.channelsBriefing.coreTrends')).toBe(
      '核心热点',
    )
    expect(lookupPath(LOCALES['zh-Hans'], 'research.channelsBriefing.weakSignals')).toBe(
      '需留意',
    )
    expect(lookupPath(LOCALES['zh-Hans'], 'research.channelsBriefing.opportunities')).toBe(
      '可跟进的机会',
    )
    expect(lookupPath(LOCALES['zh-Hans'], 'research.channelsBriefing.tryExample')).toBe(
      '试用示例',
    )
    expect(lookupPath(LOCALES['zh-Hans'], 'research.channelsBriefing.samplesTitle')).toBe(
      '试用示例',
    )
    expect(lookupPath(LOCALES['zh-Hans'], 'research.channelsBriefing.samplePrimaryCategory')).toBe(
      '明日简报',
    )
    expect(lookupPath(LOCALES['zh-Hans'], 'research.channelsBriefing.samplePrimaryTitle')).toBe(
      '机床业务',
    )
    expect(lookupPath(LOCALES['zh-Hans'], 'research.channelsBriefing.sampleExpansionCategory')).toBe(
      '液冷',
    )
    expect(lookupPath(LOCALES['zh-Hans'], 'research.channelsBriefing.sampleExpansionTitle')).toBe(
      '扩产',
    )
    expect(lookupPath(LOCALES['zh-Hans'], 'research.channelsBriefing.sampleConnectorCategory')).toBe(
      '液冷',
    )
    expect(lookupPath(LOCALES['zh-Hans'], 'research.channelsBriefing.sampleConnectorTitle')).toBe(
      '接头',
    )
    expect(lookupPath(LOCALES['zh-Hans'], 'research.channelsBriefing.sampleDieCastCategory')).toBe(
      '压铸',
    )
    expect(lookupPath(LOCALES['zh-Hans'], 'research.channelsBriefing.sampleDieCastTitle')).toBe(
      '第二曲线',
    )
    expect(lookupPath(LOCALES['zh-Hans'], 'research.channelsBriefing.postCount')).toBe(
      '{{count}} 条内容',
    )
    expect(lookupPath(LOCALES['zh-Hans'], 'research.channelsBriefing.generatedAt')).toBe(
      '生成于 {{time}}',
    )
    expect(lookupPath(LOCALES['zh-Hans'], 'research.channelsBriefing.postMeta')).toBe(
      '{{author}} · {{date}} · 转发 {{forwards}} / 赞 {{likes}}',
    )
    expect(lookupPath(LOCALES['zh-Hans'], 'research.channelsBriefing.sourceLabel')).toBe(
      '{{author}} · {{date}}',
    )
    expect(lookupPath(LOCALES['zh-Hans'], 'research.channelsBriefing.updateBriefing')).toBe(
      '更新简报',
    )
    expect(lookupPath(LOCALES['zh-Hans'], 'research.channelsBriefing.researchTopic')).toBe(
      '研究此热点',
    )
    expect(lookupPath(LOCALES['zh-Hans'], 'research.channelsBriefing.findCandidates')).toBe(
      '查找候选人',
    )
  })

  it('keeps sample-card copy free of forbidden audience phrasing', () => {
    const forbidden = /老板昨天|Finder Preview|片子|一句话给销售|公开 sph|generalToken|匿名|本样本/
    for (const locale of Object.values(LOCALES)) {
      const block = lookupPath(locale, 'research.channelsBriefing')
      expect(JSON.stringify(block)).not.toMatch(forbidden)
    }
  })
})
