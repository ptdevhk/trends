import { describe, expect, it } from 'vitest'

import {
  createInitialForm,
  formatProviderMembershipError,
  toActionId,
} from './auth-access-model'

describe('createInitialForm', () => {
  it('defaults to a casdoor user grant for the current workspace', () => {
    expect(createInitialForm('hr')).toEqual({
      provider: 'casdoor',
      providerSubject: '',
      providerTenant: '',
      workspaceSlug: 'hr',
      role: 'user',
    })
  })
})

describe('toActionId', () => {
  it('replaces non-alphanumeric runs with a dash', () => {
    expect(toActionId('sub-1')).toBe('sub-1')
    expect(toActionId('Sub 1/2!')).toBe('Sub-1-2-')
    expect(toActionId('weird__name')).toBe('weird-name')
  })
})

describe('formatProviderMembershipError', () => {
  it('includes the status when present', () => {
    expect(formatProviderMembershipError({ success: false, status: 403, error: 'Admin access required' }))
      .toBe('Admin access required (403)')
  })

  it('falls back to the message only for transport errors', () => {
    expect(formatProviderMembershipError({ success: false, error: 'Network down' }))
      .toBe('Network down')
  })
})
