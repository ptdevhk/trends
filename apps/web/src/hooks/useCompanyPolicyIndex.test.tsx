import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCompanyPolicyIndex } from '@/hooks/useCompanyPolicyIndex'
import type { CompanyPolicyItem, CompanyItem } from '@/hooks/useCompanyPolicies'

const {
  useCompanyPoliciesHookMock,
  workspaceMock,
} = vi.hoisted(() => ({
  useCompanyPoliciesHookMock: vi.fn(),
  workspaceMock: {
    slug: 'dev',
    isPublicSurface: false,
  },
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => workspaceMock,
}))

vi.mock('@/hooks/useCompanyPolicies', () => ({
  useCompanyPolicies: (...args: unknown[]) => useCompanyPoliciesHookMock(...args),
}))

function createPolicyData(): { companies: CompanyItem[]; policies: CompanyPolicyItem[] } {
  return {
    companies: [
      {
        _id: 'c1',
        companyKey: 'adastream-sdn-bhd',
        status: 'confirmed',
        displayName: 'Adastream Sdn Bhd',
        createdAt: 1,
        updatedAt: 1,
        aliases: [{ aliasDisplay: 'Adastream', aliasNormalized: 'adastream', source: 'observed' }],
      },
    ],
    policies: [
      {
        companyKey: 'adastream-sdn-bhd',
        displayName: 'Adastream Sdn Bhd',
        status: 'confirmed',
        scopeType: 'company',
        scopeId: 'adastream-sdn-bhd',
        revision: 1,
        effects: { visibility: 'hide', workflow: 'blocked', rankingEffect: 'band_known_bad', reasonCodes: [], summary: '' },
        createdAt: 1,
      },
    ],
  }
}

describe('useCompanyPolicyIndex', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workspaceMock.slug = 'dev'
    workspaceMock.isPublicSurface = false
    useCompanyPoliciesHookMock.mockReturnValue({
      companies: [],
      policies: [],
      loading: false,
      error: null,
      load: vi.fn(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches companies and policies on a workspace surface', () => {
    useCompanyPoliciesHookMock.mockReturnValue({
      ...createPolicyData(),
      loading: false,
      error: null,
      load: vi.fn(),
    })

    const { result } = renderHook(() => useCompanyPolicyIndex(true))

    expect(useCompanyPoliciesHookMock).toHaveBeenCalledWith(true)
    expect(result.current.hasPolicies).toBe(true)
    expect(result.current.matchResume({ workHistory: [{ companyName: 'Adastream' }] })).toEqual(
      expect.arrayContaining([expect.objectContaining({ companyKey: 'adastream-sdn-bhd' })]),
    )
  })

  it('skips the workspace-gated fetch on the public surface', () => {
    workspaceMock.isPublicSurface = true

    const { result } = renderHook(() => useCompanyPolicyIndex(true))

    // The public surface must not call workspace-gated API endpoints
    // (they 401/403 for anonymous / non-member viewers).
    expect(useCompanyPoliciesHookMock).toHaveBeenCalledWith(false)
    expect(result.current.hasPolicies).toBe(false)
    expect(result.current.matchResume({ workHistory: [{ companyName: 'Adastream' }] })).toEqual([])
  })

  it('defaults to disabled on the public surface even without an explicit flag', () => {
    workspaceMock.isPublicSurface = true

    renderHook(() => useCompanyPolicyIndex())

    expect(useCompanyPoliciesHookMock).toHaveBeenCalledWith(false)
  })
})
