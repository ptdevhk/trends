import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('ResearchCompanyPage route mount', () => {
  it('App mounts /:teamSlug/research/:companyKey', () => {
    const appPath = resolve(__dirname, '../App.tsx')
    const source = readFileSync(appPath, 'utf8')
    expect(source).toContain('path="research/:companyKey"')
    expect(source).toContain('ResearchCompanyPage')
  })
})
