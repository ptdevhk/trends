import { describe, expect, it } from 'vitest'
import {
  formatWorkspaceSlugList,
  getWorkspaceDisplayName,
  isPersonalWorkspaceSlugFormat,
  isReservedWorkspaceSlug,
  isSystemWorkspace,
  isValidWorkspace,
  listSystemWorkspaceSlugs,
  listWorkspaceSlugs,
  slugifyUsernameForWorkspace,
  WORKSPACE_TEAMS,
} from './workspace'

describe('WORKSPACE_TEAMS', () => {
  it('has only system data workspaces with stable keys', () => {
    expect(Object.keys(WORKSPACE_TEAMS)).toEqual(['dev', 'hr'])
  })
})

describe('workspace registry helpers', () => {
  it('lists system workspace slugs in registry order', () => {
    expect(listSystemWorkspaceSlugs()).toEqual(['dev', 'hr'])
    expect(listWorkspaceSlugs()).toEqual(['dev', 'hr'])
  })

  it('formats system workspace slugs for consumer error messages', () => {
    expect(formatWorkspaceSlugList()).toBe('dev, hr')
  })

  it('keeps the helper list aligned with validation', () => {
    for (const slug of listWorkspaceSlugs()) {
      expect(isValidWorkspace(slug)).toBe(true)
      expect(isSystemWorkspace(slug)).toBe(true)
    }
  })
})

describe('slugifyUsernameForWorkspace', () => {
  it('normalizes usernames to personal slugs', () => {
    expect(slugifyUsernameForWorkspace('Alice_Chen')).toBe('alice-chen')
    expect(slugifyUsernameForWorkspace('  bob.smith  ')).toBe('bob-smith')
  })

  it('strips invalid characters', () => {
    expect(slugifyUsernameForWorkspace('a@b#c')).toBe('a-b-c')
  })
})

describe('isReservedWorkspaceSlug', () => {
  it('reserves system and route namespaces', () => {
    expect(isReservedWorkspaceSlug('hr')).toBe(true)
    expect(isReservedWorkspaceSlug('dev')).toBe(true)
    expect(isReservedWorkspaceSlug('Admin')).toBe(true)
    expect(isReservedWorkspaceSlug('login')).toBe(true)
  })

  it('allows ordinary personal names', () => {
    expect(isReservedWorkspaceSlug('alice')).toBe(false)
    expect(isReservedWorkspaceSlug('alice-chen')).toBe(false)
  })
})

describe('isValidWorkspace', () => {
  it('returns true for system teams', () => {
    expect(isValidWorkspace('dev')).toBe(true)
    expect(isValidWorkspace('hr')).toBe(true)
  })

  it('returns true for personal format slugs', () => {
    expect(isValidWorkspace('alice')).toBe(true)
    expect(isValidWorkspace('alice-chen')).toBe(true)
    expect(isPersonalWorkspaceSlugFormat('alice-chen')).toBe(true)
  })

  it('returns false for reserved names even if format matches', () => {
    expect(isValidWorkspace('admin')).toBe(false)
    expect(isValidWorkspace('login')).toBe(false)
    expect(isValidWorkspace('constructor')).toBe(false)
  })

  it('returns false for empty string and bad format', () => {
    expect(isValidWorkspace('')).toBe(false)
    expect(isValidWorkspace('-alice')).toBe(false)
    expect(isValidWorkspace('Alice')).toBe(false)
  })

  it('returns false for inherited object property names', () => {
    expect(isValidWorkspace('toString')).toBe(false)
    expect(isValidWorkspace('constructor')).toBe(false)
  })
})

describe('getWorkspaceDisplayName', () => {
  it('uses system team names', () => {
    expect(getWorkspaceDisplayName('hr')).toBe('HR Team')
    expect(getWorkspaceDisplayName('dev')).toBe('Development')
  })

  it('title-cases personal slugs', () => {
    expect(getWorkspaceDisplayName('alice-chen')).toBe('Alice Chen')
  })
})
