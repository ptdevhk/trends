import { describe, expect, it } from 'vitest'
import { isValidWorkspace, getAccessLevel, WORKSPACE_TEAMS, formatWorkspaceSlugList, listWorkspaceSlugs } from './workspace'

describe('WORKSPACE_TEAMS', () => {
  it('has admin, dev, and hr teams', () => {
    expect(Object.keys(WORKSPACE_TEAMS)).toEqual(['admin', 'dev', 'hr'])
  })
})

describe('workspace registry helpers', () => {
  it('lists registered workspace slugs in registry order', () => {
    expect(listWorkspaceSlugs()).toEqual(['admin', 'dev', 'hr'])
  })

  it('formats registered workspace slugs for consumer error messages', () => {
    expect(formatWorkspaceSlugList()).toBe('admin, dev, hr')
  })

  it('keeps the helper list aligned with validation and access levels', () => {
    for (const slug of listWorkspaceSlugs()) {
      expect(isValidWorkspace(slug)).toBe(true)
      expect(getAccessLevel(slug)).toBe(WORKSPACE_TEAMS[slug].accessLevel)
    }
  })
})

describe('isValidWorkspace', () => {
  it('returns true for admin', () => {
    expect(isValidWorkspace('admin')).toBe(true)
  })

  it('returns true for dev', () => {
    expect(isValidWorkspace('dev')).toBe(true)
  })

  it('returns true for hr', () => {
    expect(isValidWorkspace('hr')).toBe(true)
  })

  it('returns false for unknown slug', () => {
    expect(isValidWorkspace('prod')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isValidWorkspace('')).toBe(false)
  })

  it('returns false for inherited object property names', () => {
    expect(isValidWorkspace('toString')).toBe(false)
    expect(isValidWorkspace('constructor')).toBe(false)
  })
})

describe('getAccessLevel', () => {
  it('returns admin for admin', () => {
    expect(getAccessLevel('admin')).toBe('admin')
  })

  it('returns user for dev', () => {
    expect(getAccessLevel('dev')).toBe('user')
  })

  it('returns user for hr', () => {
    expect(getAccessLevel('hr')).toBe('user')
  })

  it('returns null for unknown slug', () => {
    expect(getAccessLevel('prod')).toBeNull()
  })
})
