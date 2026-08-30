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

const CHECKLIST_KEYS = [
  'resumes.detail.screeningChecklist.title',
  'resumes.detail.screeningChecklist.unavailable',
  'resumes.detail.screeningChecklist.generatedBy',
  'resumes.detail.screeningChecklist.items.sellsMachines',
  'resumes.detail.screeningChecklist.items.machineOrigin',
  'resumes.detail.screeningChecklist.items.channel',
  'resumes.detail.screeningChecklist.items.region',
  'resumes.detail.screeningChecklist.items.contactStatus',
  'resumes.detail.screeningChecklist.verdicts.sellsMachines.yes',
  'resumes.detail.screeningChecklist.verdicts.sellsMachines.no',
  'resumes.detail.screeningChecklist.verdicts.sellsMachines.unclear',
  'resumes.detail.screeningChecklist.verdicts.machineOrigin.international',
  'resumes.detail.screeningChecklist.verdicts.machineOrigin.domestic',
  'resumes.detail.screeningChecklist.verdicts.machineOrigin.unknown',
  'resumes.detail.screeningChecklist.verdicts.channel.direct',
  'resumes.detail.screeningChecklist.verdicts.channel.distributor',
  'resumes.detail.screeningChecklist.verdicts.channel.unclear',
  'resumes.detail.screeningChecklist.verdicts.contactStatus.valid',
  'resumes.detail.screeningChecklist.verdicts.contactStatus.problem',
  'resumes.detail.screeningChecklist.verdicts.contactStatus.unclear',
]

describe('screening checklist i18n keys', () => {
  it('resolves every screening checklist key to a non-empty string in all 3 locales', () => {
    const missing: string[] = []
    for (const key of CHECKLIST_KEYS) {
      for (const [localeName, locale] of Object.entries(LOCALES)) {
        const value = lookupPath(locale, key)
        if (typeof value !== 'string' || value.trim() === '') {
          missing.push(`${key} (${localeName})`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('matches expected zh-Hant and zh-Hans translations', () => {
    expect(lookupPath(LOCALES['zh-Hant'], 'resumes.detail.screeningChecklist.title')).toBe('篩選檢查清單')
    expect(lookupPath(LOCALES['zh-Hans'], 'resumes.detail.screeningChecklist.title')).toBe('筛选检查清单')
    expect(lookupPath(LOCALES['zh-Hant'], 'resumes.detail.screeningChecklist.items.region')).toBe('區域')
    expect(lookupPath(LOCALES['zh-Hans'], 'resumes.detail.screeningChecklist.items.region')).toBe('区域')

    // sellsMachines
    expect(lookupPath(LOCALES['zh-Hant'], 'resumes.detail.screeningChecklist.verdicts.sellsMachines.yes')).toBe('有賣機')
    expect(lookupPath(LOCALES['zh-Hant'], 'resumes.detail.screeningChecklist.verdicts.sellsMachines.no')).toBe('無賣機')
    expect(lookupPath(LOCALES['zh-Hant'], 'resumes.detail.screeningChecklist.verdicts.sellsMachines.unclear')).toBe('不明')

    // machineOrigin
    expect(lookupPath(LOCALES['zh-Hant'], 'resumes.detail.screeningChecklist.verdicts.machineOrigin.international')).toBe('進口')
    expect(lookupPath(LOCALES['zh-Hant'], 'resumes.detail.screeningChecklist.verdicts.machineOrigin.domestic')).toBe('國產')
    expect(lookupPath(LOCALES['zh-Hant'], 'resumes.detail.screeningChecklist.verdicts.machineOrigin.unknown')).toBe('未能核實')

    // channel
    expect(lookupPath(LOCALES['zh-Hant'], 'resumes.detail.screeningChecklist.verdicts.channel.direct')).toBe('直銷')
    expect(lookupPath(LOCALES['zh-Hant'], 'resumes.detail.screeningChecklist.verdicts.channel.distributor')).toBe('代理商')
    expect(lookupPath(LOCALES['zh-Hant'], 'resumes.detail.screeningChecklist.verdicts.channel.unclear')).toBe('不明')

    // contactStatus
    expect(lookupPath(LOCALES['zh-Hant'], 'resumes.detail.screeningChecklist.verdicts.contactStatus.valid')).toBe('可聯絡')
    expect(lookupPath(LOCALES['zh-Hant'], 'resumes.detail.screeningChecklist.verdicts.contactStatus.problem')).toBe('有問題')
    expect(lookupPath(LOCALES['zh-Hant'], 'resumes.detail.screeningChecklist.verdicts.contactStatus.unclear')).toBe('不明')
  })
})
