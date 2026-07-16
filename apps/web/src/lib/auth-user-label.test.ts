import { describe, expect, it } from 'vitest'
import { formatAuthUserLabel } from './auth-user-label'

describe('formatAuthUserLabel', () => {
  it('prefers displayName over email and id', () => {
    expect(formatAuthUserLabel({
      id: 'f2a53aee-b31c-4d8d-836e-2b8e4bbc33db',
      email: 'hr@example.com',
      displayName: 'HR Operator',
    })).toBe('HR Operator')
  })

  it('falls back to email when displayName is missing', () => {
    expect(formatAuthUserLabel({
      id: 'f2a53aee-b31c-4d8d-836e-2b8e4bbc33db',
      email: 'hr@example.com',
    })).toBe('hr@example.com')
  })

  it('uses non-UUID ids such as local usernames', () => {
    expect(formatAuthUserLabel({ id: 'demo-admin' })).toBe('demo-admin')
  })

  it('never shows raw UUIDs to the user', () => {
    expect(formatAuthUserLabel({
      id: 'f2a53aee-b31c-4d8d-836e-2b8e4bbc33db',
    })).toBe('Account')
  })
})
