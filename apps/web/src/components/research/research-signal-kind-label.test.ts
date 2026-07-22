import { describe, expect, it } from 'vitest'
import { researchSignalKindLabel } from './research-signal-kind-label'

describe('researchSignalKindLabel', () => {
  it('maps API kind tokens to ZH HR-desk labels (not raw snake_case)', () => {
    expect(researchSignalKindLabel('hiring_signal')).toBe('招聘')
    expect(researchSignalKindLabel('sales_trigger')).toBe('销售')
    expect(researchSignalKindLabel('market_move')).toBe('市场')
    expect(researchSignalKindLabel('company_mention')).toBe('提及')
  })

  it('passes through unknown kinds without inventing labels', () => {
    expect(researchSignalKindLabel('custom_kind')).toBe('custom_kind')
  })
})
