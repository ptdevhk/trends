import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('ResearchIndexPage route mount', () => {
  it('App mounts research index and company routes', () => {
    const appPath = resolve(__dirname, '../App.tsx')
    const source = readFileSync(appPath, 'utf8')
    expect(source).toContain('path="research"')
    expect(source).toContain('path="research/:companyKey"')
    expect(source).toContain('ResearchIndexPage')
  })
})
