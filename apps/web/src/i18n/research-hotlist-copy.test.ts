import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Drive the shipped locale JSON (not a reimplementation) so hub 综合热榜
 * cannot regress to 市场动态 via i18n keys.
 */
function loadLocale(name: string): Record<string, unknown> {
  const path = resolve(__dirname, `locales/${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

describe('research hub hotlist copy (shipped locales)', () => {
  it('zh-Hans sectionPulse is 综合热榜, not 市场动态', () => {
    const locale = loadLocale('zh-Hans')
    const research = locale.research as Record<string, string>
    expect(research.sectionPulse).toBe('综合热榜')
    expect(research.pulseLoadError).toBe('综合热榜加载失败')
    expect(research.sectionPulse).not.toContain('市场动态')
    expect(research.pulseLoadError).not.toContain('市场动态')
  })

  it('zh-Hant and en no longer use 市场动态 for sectionPulse/pulseLoadError', () => {
    const hant = loadLocale('zh-Hant').research as Record<string, string>
    const en = loadLocale('en').research as Record<string, string>
    expect(hant.sectionPulse).toBe('綜合熱榜')
    expect(hant.pulseLoadError).not.toContain('市场动态')
    expect(en.sectionPulse).toBe('Hotlist')
    expect(en.pulseLoadError).not.toContain('市场动态')
  })
})
