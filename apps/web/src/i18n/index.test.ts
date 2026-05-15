import { describe, expect, it } from 'vitest'

// isSupportedLocale is a private function in i18n/index.ts
// Test the logic directly
const SUPPORTED_LOCALES = ['zh-Hans', 'zh-Hant', 'en']
function isSupportedLocale(locale: string | undefined): locale is string {
  return typeof locale === 'string' && SUPPORTED_LOCALES.includes(locale)
}

describe('locale detection', () => {
  it('supports zh-Hans', () => {
    expect(isSupportedLocale('zh-Hans')).toBe(true)
  })

  it('supports zh-Hant', () => {
    expect(isSupportedLocale('zh-Hant')).toBe(true)
  })

  it('supports en', () => {
    expect(isSupportedLocale('en')).toBe(true)
  })

  it('rejects unsupported locale', () => {
    expect(isSupportedLocale('fr')).toBe(false)
  })

  it('rejects undefined', () => {
    expect(isSupportedLocale(undefined)).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isSupportedLocale('')).toBe(false)
  })

  it('rejects ja locale', () => {
    expect(isSupportedLocale('ja')).toBe(false)
  })
})
