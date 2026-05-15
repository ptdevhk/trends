import { describe, expect, it } from 'vitest'
import { isValidWorkspace, getAccessLevel, WORKSPACE_TEAMS } from './workspace'

describe('WORKSPACE_TEAMS', () => {
  it('has dev and hr teams', () => {
    expect(Object.keys(WORKSPACE_TEAMS)).toEqual(['dev', 'hr'])
  })
})

describe('isValidWorkspace', () => {
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
})

describe('getAccessLevel', () => {
  it('returns admin for dev', () => {
    expect(getAccessLevel('dev')).toBe('admin')
  })

  it('returns user for hr', () => {
    expect(getAccessLevel('hr')).toBe('user')
  })

  it('returns null for unknown slug', () => {
    expect(getAccessLevel('prod')).toBeNull()
  })
})
