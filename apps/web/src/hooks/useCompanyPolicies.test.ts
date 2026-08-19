import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getMock = vi.hoisted(() => vi.fn())
const postMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    GET: (...args: unknown[]) => getMock(...args),
    POST: (...args: unknown[]) => postMock(...args),
  },
}))

const companyItem = {
  _id: 'c1',
  companyKey: 'acme-cnc',
  status: 'confirmed',
  displayName: 'Acme CNC',
  createdAt: 1,
  updatedAt: 1,
  aliases: [],
}

const workspacePolicy = {
  companyKey: 'acme-cnc',
  displayName: 'Acme CNC',
  status: 'confirmed',
  scopeType: 'workspace',
  scopeId: 'hr',
  revision: 2,
  effects: { visibility: 'default' },
  createdAt: 1,
}

const marketPolicy = {
  companyKey: 'acme-cnc',
  displayName: 'Acme CNC',
  status: 'confirmed',
  scopeType: 'market',
  scopeId: 'cn',
  revision: 1,
  effects: { rankingEffect: 'none' },
  createdAt: 1,
}

function okResponse(items: unknown[]) {
  return { data: { success: true, items } }
}

function forbiddenResponse() {
  return { error: { message: 'Admin access required' }, response: { status: 403 } }
}

function hardErrorResponse() {
  return { error: { message: 'boom' }, response: { status: 500 } }
}

describe('useCompanyPolicies', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
    // The hook keeps a module-level cache; reset modules so each test starts
    // with a fresh fetch.
    vi.resetModules()
  })

  it('treats 403 market responses as empty market layers for non-admins', async () => {
    getMock
      .mockResolvedValueOnce(okResponse([companyItem]))
      .mockResolvedValueOnce(okResponse([workspacePolicy]))
      .mockResolvedValueOnce(forbiddenResponse())
      .mockResolvedValueOnce(forbiddenResponse())
    const { useCompanyPolicies } = await import('./useCompanyPolicies')
    const { result } = renderHook(() => useCompanyPolicies(true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeNull()
    expect(result.current.companies).toEqual([companyItem])
    expect(result.current.policies).toEqual([workspacePolicy])
    expect(result.current.marketPolicies).toEqual({ cn: [], my: [] })
  })

  it('loads market policies for admins', async () => {
    getMock
      .mockResolvedValueOnce(okResponse([companyItem]))
      .mockResolvedValueOnce(okResponse([workspacePolicy]))
      .mockResolvedValueOnce(okResponse([marketPolicy]))
      .mockResolvedValueOnce(okResponse([]))
    const { useCompanyPolicies } = await import('./useCompanyPolicies')
    const { result } = renderHook(() => useCompanyPolicies(true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeNull()
    expect(result.current.marketPolicies.cn).toEqual([marketPolicy])
    expect(result.current.marketPolicies.my).toEqual([])
  })

  it('fails hard when a non-403 market error occurs', async () => {
    getMock
      .mockResolvedValueOnce(okResponse([companyItem]))
      .mockResolvedValueOnce(okResponse([workspacePolicy]))
      .mockResolvedValueOnce(hardErrorResponse())
      .mockResolvedValueOnce(forbiddenResponse())
    const { useCompanyPolicies } = await import('./useCompanyPolicies')
    const { result } = renderHook(() => useCompanyPolicies(true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Failed to load company policies')
    expect(result.current.marketPolicies).toEqual({ cn: [], my: [] })
  })

  it('fails hard when the workspace policies fetch fails', async () => {
    getMock
      .mockResolvedValueOnce(okResponse([companyItem]))
      .mockResolvedValueOnce(hardErrorResponse())
      .mockResolvedValueOnce(forbiddenResponse())
      .mockResolvedValueOnce(forbiddenResponse())
    const { useCompanyPolicies } = await import('./useCompanyPolicies')
    const { result } = renderHook(() => useCompanyPolicies(true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Failed to load company policies')
  })

  it('posts market scope on setPolicyPreset', async () => {
    getMock
      .mockResolvedValueOnce(okResponse([companyItem]))
      .mockResolvedValueOnce(okResponse([workspacePolicy]))
      .mockResolvedValueOnce(forbiddenResponse())
      .mockResolvedValueOnce(forbiddenResponse())
    postMock.mockResolvedValueOnce({ data: { success: true, revision: 4 } })
    const { useCompanyPolicies } = await import('./useCompanyPolicies')
    const { result } = renderHook(() => useCompanyPolicies(true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const ok = await result.current.setPolicyPreset('acme-cnc', 'known_good', undefined, 'cn')
    expect(ok).toBe(true)
    expect(postMock).toHaveBeenCalledWith('/api/company-policies', {
      body: { companyKey: 'acme-cnc', preset: 'known_good', market: 'cn' },
    })
  })

  it('omits market from setPolicyPreset body for workspace scope', async () => {
    getMock
      .mockResolvedValueOnce(okResponse([companyItem]))
      .mockResolvedValueOnce(okResponse([workspacePolicy]))
      .mockResolvedValueOnce(forbiddenResponse())
      .mockResolvedValueOnce(forbiddenResponse())
    postMock.mockResolvedValueOnce({ data: { success: true, revision: 5 } })
    const { useCompanyPolicies } = await import('./useCompanyPolicies')
    const { result } = renderHook(() => useCompanyPolicies(true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const ok = await result.current.setPolicyPreset('acme-cnc', 'no_hire', 'reason', 'workspace')
    expect(ok).toBe(true)
    expect(postMock).toHaveBeenCalledWith('/api/company-policies', {
      body: { companyKey: 'acme-cnc', preset: 'no_hire', summary: 'reason' },
    })
  })
})
