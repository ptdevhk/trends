import { describe, expect, it } from 'vitest'
import {
  policyEffectsFromPreset,
  type CandidatePolicyOverride,
  type CompanyPolicyMatchHit,
} from '@trends/shared'
import { filterItemsByCompanyPolicyHide, getResumeCompanyPolicyState } from './company-policy-runtime'

const noHireHit: CompanyPolicyMatchHit = {
  companyKey: 'pro-technic-machinery',
  displayName: '宝力机械 / Pro-Technic Machinery',
  matchedEmployer: '东莞宝力机械',
  preset: 'no_hire',
  effects: policyEffectsFromPreset('no_hire'),
  rankingEffect: 'band_known_bad',
}

const polywellHit: CompanyPolicyMatchHit = {
  companyKey: 'polywell',
  displayName: '宝惠 / Polywell',
  matchedEmployer: '宝惠',
  preset: 'no_hire',
  effects: policyEffectsFromPreset('no_hire'),
  rankingEffect: 'band_known_bad',
}

describe('company-policy-runtime', () => {
  it('marks no-hire matches as hidden and workflow blocked', () => {
    const state = getResumeCompanyPolicyState({ workHistory: [] }, () => [noHireHit])
    expect(state.hidden).toBe(true)
    expect(state.workflowBlocked).toBe(true)
    expect(state.primary?.companyKey).toBe('pro-technic-machinery')
  })

  it('unhides candidate when all hidden companies have active overrides', () => {
    const overrides: CandidatePolicyOverride[] = [
      {
        _id: 'o1',
        workspaceSlug: 'dev',
        resumeId: 'r1',
        resumeIdentity: 'identity-1',
        companyKey: 'pro-technic-machinery',
        effect: 'allow',
        reason: 'test',
        createdAt: 0,
        updatedAt: 0,
      },
    ]

    const state = getResumeCompanyPolicyState(
      { workHistory: [], identityKey: 'identity-1' },
      () => [noHireHit],
      overrides,
    )
    expect(state.hidden).toBe(false)
    expect(state.workflowBlocked).toBe(false)
    expect(state.overriddenCompanyKeys).toContain('pro-technic-machinery')
  })

  it('keeps candidate hidden when only partial hidden companies are overridden', () => {
    const overrides: CandidatePolicyOverride[] = [
      {
        _id: 'o1',
        workspaceSlug: 'dev',
        resumeId: 'r1',
        resumeIdentity: 'identity-1',
        companyKey: 'pro-technic-machinery',
        effect: 'allow',
        reason: 'test',
        createdAt: 0,
        updatedAt: 0,
      },
    ]

    const state = getResumeCompanyPolicyState(
      { workHistory: [], identityKey: 'identity-1' },
      () => [noHireHit, polywellHit],
      overrides,
    )
    expect(state.hidden).toBe(true)
    expect(state.workflowBlocked).toBe(true)
    expect(state.overriddenCompanyKeys).toEqual(['pro-technic-machinery'])
  })

  it('filters hidden items by default and counts them', () => {
    const items = [
      { id: 'a', hidden: false },
      { id: 'b', hidden: true },
      { id: 'c', hidden: false },
    ]
    const matchResume = (input: {
      workHistory?: Array<{ companyName?: string; raw?: string } | null | undefined> | null
    }) => {
      const company = input.workHistory?.find(Boolean)?.companyName
      return company === 'no-hire-co' ? [noHireHit] : []
    }
    const resolve = (item: (typeof items)[number]) => ({
      workHistory: item.hidden ? [{ companyName: 'no-hire-co' }] : [{ companyName: 'other' }],
    })

    const filtered = filterItemsByCompanyPolicyHide(items, resolve, matchResume, false)
    expect(filtered.visible.map((item) => item.id)).toEqual(['a', 'c'])
    expect(filtered.hiddenCount).toBe(1)

    const shown = filterItemsByCompanyPolicyHide(items, resolve, matchResume, true)
    expect(shown.visible).toHaveLength(3)
    expect(shown.hiddenCount).toBe(1)
  })

  it('filterItemsByCompanyPolicyHide surfaces overridden rows when showHidden=false', () => {
    const items = [
      { id: 'a', companyName: 'other', identity: 'id-a' },
      { id: 'b', companyName: 'no-hire-co', identity: 'id-b' },
    ]
    const overrides: CandidatePolicyOverride[] = [
      {
        _id: 'o1',
        workspaceSlug: 'dev',
        resumeId: 'b',
        resumeIdentity: 'id-b',
        companyKey: 'pro-technic-machinery',
        effect: 'allow',
        reason: 'test',
        createdAt: 0,
        updatedAt: 0,
      },
    ]
    const matchResume = (input: {
      workHistory?: Array<{ companyName?: string; raw?: string } | null | undefined> | null
    }) => {
      const company = input.workHistory?.find(Boolean)?.companyName
      return company === 'no-hire-co' ? [noHireHit] : []
    }
    const resolve = (item: (typeof items)[number]) => ({
      workHistory: [{ companyName: item.companyName }],
      identityKey: item.identity,
    })

    const result = filterItemsByCompanyPolicyHide(items, resolve, matchResume, false, overrides)
    expect(result.visible.map((i) => i.id)).toEqual(['a', 'b'])
    expect(result.hiddenCount).toBe(0)
  })
})
