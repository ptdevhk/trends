import { describe, expect, it } from 'vitest'
import { policyEffectsFromPreset, type CompanyPolicyMatchHit } from '@trends/shared'
import { filterItemsByCompanyPolicyHide, getResumeCompanyPolicyState } from './company-policy-runtime'

const noHireHit: CompanyPolicyMatchHit = {
  companyKey: 'pro-technic-machinery',
  displayName: '宝力机械 / Pro-Technic Machinery',
  matchedEmployer: '东莞宝力机械',
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
})
