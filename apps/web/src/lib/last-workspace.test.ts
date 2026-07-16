import { beforeEach, describe, expect, it } from 'vitest'
import {
  readLastWorkspaceSlug,
  resolvePreferredWorkspaceSlug,
  writeLastWorkspaceSlug,
} from './last-workspace'

describe('last-workspace', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('persists and reads last workspace per user', () => {
    writeLastWorkspaceSlug('u1', 'alice')
    expect(readLastWorkspaceSlug('u1')).toBe('alice')
    expect(readLastWorkspaceSlug('u2')).toBeNull()
  })

  it('prefers last workspace when membership still exists', () => {
    writeLastWorkspaceSlug('u1', 'hr')
    expect(resolvePreferredWorkspaceSlug('u1', [
      { userId: 'u1', workspaceSlug: 'alice', role: 'user' },
      { userId: 'u1', workspaceSlug: 'hr', role: 'user' },
    ])).toBe('hr')
  })

  it('falls back to personal then first membership', () => {
    expect(resolvePreferredWorkspaceSlug('u1', [
      { userId: 'u1', workspaceSlug: 'dev', role: 'user' },
      { userId: 'u1', workspaceSlug: 'alice', role: 'user' },
    ])).toBe('alice')
  })

  it('ignores invalid storage values', () => {
    window.localStorage.setItem('trends.lastWorkspace.u1', 'Admin')
    expect(readLastWorkspaceSlug('u1')).toBeNull()
  })
})
