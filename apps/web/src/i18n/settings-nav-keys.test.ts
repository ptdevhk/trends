import { describe, expect, it } from 'vitest'
import { SETTINGS_NAV_ITEMS, SYSTEM_SETTINGS_NAV_ITEMS } from '@trends/shared'

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

const NAV_ITEMS = [...SETTINGS_NAV_ITEMS, ...SYSTEM_SETTINGS_NAV_ITEMS]

describe('settings nav i18n keys', () => {
  it('resolves every nav titleKey to a non-empty string in all locales', () => {
    const missing: string[] = []
    for (const item of NAV_ITEMS) {
      for (const [localeName, locale] of Object.entries(LOCALES)) {
        const value = lookupPath(locale, item.titleKey)
        if (typeof value !== 'string' || value.trim() === '') {
          missing.push(`${item.titleKey} (${localeName})`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('localizes the setup and search setup nav labels', () => {
    expect(lookupPath(LOCALES.en, 'settings.setup.nav')).toBe('Setup')
    expect(lookupPath(LOCALES['zh-Hans'], 'settings.setup.nav')).toBe('设置')
    expect(lookupPath(LOCALES['zh-Hant'], 'settings.setup.nav')).toBe('設置')
    expect(lookupPath(LOCALES.en, 'settings.searchSetup.nav')).toBe('Search setup')
    expect(lookupPath(LOCALES['zh-Hans'], 'settings.searchSetup.nav')).toBe('搜索设置')
    expect(lookupPath(LOCALES['zh-Hant'], 'settings.searchSetup.nav')).toBe('搜尋設定')
  })

  it('localizes the research nav label in zh locales (no English leftover)', () => {
    expect(lookupPath(LOCALES.en, 'nav.research')).toBe('Research')
    expect(lookupPath(LOCALES['zh-Hans'], 'nav.research')).toBe('研究')
    expect(lookupPath(LOCALES['zh-Hant'], 'nav.research')).toBe('研究')
  })
})
