import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadLocale(name: string): Record<string, unknown> {
  const path = resolve(__dirname, `locales/${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

describe('research hub news-sources copy (shipped locales)', () => {
  it('all three locales carry the newsSources opt-out keys', () => {
    for (const loc of ['zh-Hans', 'zh-Hant', 'en']) {
      const nl = (loadLocale(loc).research as Record<string, unknown>).newsSources as Record<
        string,
        string
      >
      expect(nl).toBeDefined()
      for (const key of ['open', 'summary', 'dialogTitle', 'dialogDescription', 'master', 'activeCount']) {
        expect(typeof nl[key]).toBe('string')
        expect(nl[key].length).toBeGreaterThan(0)
      }
    }
  })

  it('zh-Hans dialogTitle is 新闻数据源 (data-source surface, not hotlist)', () => {
    const ns = (loadLocale('zh-Hans').research as Record<string, Record<string, string>>).newsSources
    expect(ns.dialogTitle).toBe('新闻数据源')
    expect(ns.master).toContain('CNC')
  })

  it('en master mentions CNC/machine-tool', () => {
    const ns = (loadLocale('en').research as Record<string, Record<string, string>>).newsSources
    expect(ns.master.toLowerCase()).toContain('cnc')
  })
})
