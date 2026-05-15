import { describe, expect, it, beforeEach } from 'vitest'
import { workspaceRef, withWorkspaceHeaders } from '@/lib/workspace-ref'

describe('workspaceRef', () => {
  beforeEach(() => {
    workspaceRef.set('dev')
  })

  it('returns default slug', () => {
    expect(workspaceRef.get()).toBe('dev')
  })

  it('sets and gets slug', () => {
    workspaceRef.set('prod')
    expect(workspaceRef.get()).toBe('prod')
  })

  it('supports multiple set/get cycles', () => {
    workspaceRef.set('a')
    expect(workspaceRef.get()).toBe('a')
    workspaceRef.set('b')
    expect(workspaceRef.get()).toBe('b')
  })
})

describe('withWorkspaceHeaders', () => {
  beforeEach(() => {
    workspaceRef.set('dev')
  })

  it('adds X-Workspace-Slug header', () => {
    const headers = withWorkspaceHeaders()
    expect(headers.get('X-Workspace-Slug')).toBe('dev')
  })

  it('preserves existing headers', () => {
    const headers = withWorkspaceHeaders({ 'Content-Type': 'application/json' })
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('X-Workspace-Slug')).toBe('dev')
  })

  it('reflects current workspace slug', () => {
    workspaceRef.set('prod')
    const headers = withWorkspaceHeaders()
    expect(headers.get('X-Workspace-Slug')).toBe('prod')
  })
})
