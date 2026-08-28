import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  CN_ADJACENT_PRODUCT_SCORE_CAP_RULE,
  listActiveScoreCapRules,
} from '../../../../../packages/shared/src/scoring/score-cap-rules'
import { ScoreCapRulesList } from './SystemSettingsScoreCapsPage'

const mockT = (key: string, opts?: string | Record<string, unknown>): string => {
  if (typeof opts === 'string') return opts
  if (opts && typeof opts === 'object' && 'defaultValue' in opts) {
    return String(opts.defaultValue)
  }
  return key
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

describe('SystemSettingsScoreCapsPage', () => {
  it('renders the adjacent-product cap from the shared registry', () => {
    const rules = listActiveScoreCapRules()
    render(<ScoreCapRulesList rules={rules} />)

    expect(screen.getByText(CN_ADJACENT_PRODUCT_SCORE_CAP_RULE.id)).toBeInTheDocument()
    expect(screen.getByText('刀具/配件/电气/气动/注塑/齿轮机 must not score as 整机机床销售')).toBeInTheDocument()
    expect(screen.getAllByText('整机机床销售').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('整机数控机床销售').length).toBeGreaterThanOrEqual(1)

    for (const keyword of ['刀具', '配件', '电气', '气动', '注塑', '齿轮机']) {
      expect(screen.getByText(keyword)).toBeInTheDocument()
    }

    expect(screen.getByText(`related_exp ${CN_ADJACENT_PRODUCT_SCORE_CAP_RULE.relatedExpCap}`)).toBeInTheDocument()
    expect(screen.getByText(`industry_db ${CN_ADJACENT_PRODUCT_SCORE_CAP_RULE.industryDbCap}`)).toBeInTheDocument()
    expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(1)
    expect(rules.map((rule) => rule.id)).toContain(CN_ADJACENT_PRODUCT_SCORE_CAP_RULE.id)
  })

  it('shows an empty state when no cap rules are active', () => {
    render(<ScoreCapRulesList rules={[]} />)
    expect(screen.getByTestId('score-caps-empty')).toHaveTextContent('No active score-cap rules.')
    expect(screen.queryByTestId('score-caps-rule-row')).not.toBeInTheDocument()
  })
})
