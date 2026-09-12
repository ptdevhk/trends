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

const CONNECTION_KEYS = [
  'resumes.searchPage.connection.disconnectedTitle',
  'resumes.searchPage.connection.disconnectedDescription',
]

describe('convex connection i18n keys', () => {
  it('resolves every connection copy key to a non-empty string in all locales', () => {
    const missing: string[] = []
    for (const key of CONNECTION_KEYS) {
      for (const [localeName, locale] of Object.entries(LOCALES)) {
        const value = lookupPath(locale, key)
        if (typeof value !== 'string' || value.trim() === '') {
          missing.push(`${key} (${localeName})`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('keeps English connection copy user-facing and specific', () => {
    expect(lookupPath(LOCALES.en, CONNECTION_KEYS[0])).toBe('Connection interrupted')
    expect(lookupPath(LOCALES.en, CONNECTION_KEYS[1])).toMatch(/temporarily unavailable/i)
  })
})
