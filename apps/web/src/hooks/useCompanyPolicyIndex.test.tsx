import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  matchResumeCompanyPolicyCached,
  useCompanyPolicyIndex,
} from '@/hooks/useCompanyPolicyIndex'
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

const NO_HIRE_EFFECTS = {
  visibility: 'hide',
  workflow: 'blocked',
  rankingEffect: 'band_known_bad',
  reasonCodes: [] as string[],
  summary: '',
}

/** The "none" preset's exact effects bag; neutralize bag for market rows. */
const NONE_EFFECTS = {
  visibility: 'default',
  workflow: 'default',
  rankingEffect: 'none',
  reasonCodes: [] as string[],
  summary: '',
}

const COMPANY: CompanyItem = {
  _id: 'c1',
  companyKey: 'adastream-sdn-bhd',
  status: 'confirmed',
  displayName: 'Adastream Sdn Bhd',
  createdAt: 1,
  updatedAt: 1,
  aliases: [{ aliasDisplay: 'Adastream', aliasNormalized: 'adastream', source: 'observed' }],
}

function policyRow(
  companyKey: string,
  effects: { visibility: string; workflow: string; rankingEffect: string; reasonCodes: string[]; summary: string },
): CompanyPolicyItem {
  return {
    companyKey,
    displayName: COMPANY.displayName,
    status: 'confirmed',
    scopeType: 'workspace',
    scopeId: 'dev',
    revision: 1,
    effects,
    createdAt: 1,
  }
}

function createPolicyData(): { companies: CompanyItem[]; policies: CompanyPolicyItem[] } {
  return {
    companies: [COMPANY],
    policies: [policyRow('adastream-sdn-bhd', NO_HIRE_EFFECTS)],
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
      marketPolicies: { cn: [], my: [] },
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
      marketPolicies: { cn: [], my: [] },
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

  it('a CN market "none" overrides the workspace no-hire for CN resumes only', () => {
    useCompanyPoliciesHookMock.mockReturnValue({
      ...createPolicyData(),
      marketPolicies: {
        cn: [policyRow('adastream-sdn-bhd', NONE_EFFECTS)],
        my: [],
      },
      loading: false,
      error: null,
      load: vi.fn(),
    })

    const { result } = renderHook(() => useCompanyPolicyIndex(true))

    // CN-sourced resume: the market "none" row neutralizes the workspace no-hire.
    expect(
      result.current.matchResume({ workHistory: [{ companyName: 'Adastream' }], sourceKey: 'job5156' }),
    ).toEqual([])
    // MY-sourced resume: no MY row, so the workspace no-hire still applies.
    expect(result.current.matchResume({ workHistory: [{ companyName: 'Adastream' }], sourceKey: 'seek' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ companyKey: 'adastream-sdn-bhd' })]),
    )
  })

  it('a MY market no-hire applies to MY resumes and leaves CN resumes unaffected', () => {
    useCompanyPoliciesHookMock.mockReturnValue({
      companies: [COMPANY],
      policies: [],
      marketPolicies: {
        cn: [],
        my: [policyRow('adastream-sdn-bhd', NO_HIRE_EFFECTS)],
      },
      loading: false,
      error: null,
      load: vi.fn(),
    })

    const { result } = renderHook(() => useCompanyPolicyIndex(true))

    expect(result.current.matchResume({ workHistory: [{ companyName: 'Adastream' }], sourceKey: 'seek' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ companyKey: 'adastream-sdn-bhd' })]),
    )
    expect(
      result.current.matchResume({ workHistory: [{ companyName: 'Adastream' }], sourceKey: 'job5156' }),
    ).toEqual([])
    // No sourceKey → defaults to the CN market.
    expect(result.current.matchResume({ workHistory: [{ companyName: 'Adastream' }] })).toEqual([])
  })

  it('matchResumeCompanyPolicyCached routes by resume source market (bulk handlers)', () => {
    useCompanyPoliciesHookMock.mockReturnValue({
      companies: [COMPANY],
      policies: [],
      marketPolicies: {
        cn: [],
        my: [policyRow('adastream-sdn-bhd', NO_HIRE_EFFECTS)],
      },
      loading: false,
      error: null,
      load: vi.fn(),
    })

    renderHook(() => useCompanyPolicyIndex(true))

    expect(
      matchResumeCompanyPolicyCached({ workHistory: [{ companyName: 'Adastream' }], sourceKey: 'seek' }),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ companyKey: 'adastream-sdn-bhd' })]))
    expect(
      matchResumeCompanyPolicyCached({ workHistory: [{ companyName: 'Adastream' }], sourceKey: '51job' }),
    ).toEqual([])
  })
})
