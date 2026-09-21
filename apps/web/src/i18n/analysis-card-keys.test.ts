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

const ANALYSIS_CARD_KEYS = [
  'resumes.searchPage.card.analysisForKeywords',
  'resumes.searchPage.card.analysisForKeywordsWithDuty',
  'resumes.searchPage.card.analysisForJob',
]

describe('analysis-card copy keys', () => {
  it('resolves every card-label key to a non-empty string in all locales', () => {
    const missing: string[] = []
    for (const key of ANALYSIS_CARD_KEYS) {
      for (const [localeName, locale] of Object.entries(LOCALES)) {
        const value = lookupPath(locale, key)
        if (typeof value !== 'string' || value.trim() === '') {
          missing.push(`${key} (${localeName})`)
        }
      }
    }
    expect(missing).toEqual([])
  })
})
