import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AnalysisBreakdownPanel } from './AnalysisBreakdownPanel'

describe('AnalysisBreakdownPanel', () => {
  it('renders bar + tiles with weighted related_exp contribution', () => {
    render(
      <AnalysisBreakdownPanel
        title="分析拆解"
        breakdown={{ related_exp: 76, industry_db: 40 }}
      />,
    )

    expect(screen.getByText('分析拆解')).toBeInTheDocument()
    expect(screen.getByTestId('analysis-breakdown-bar')).toBeInTheDocument()
    expect(screen.getAllByText('related exp')).toHaveLength(2)
    expect(screen.getAllByText('industry db')).toHaveLength(2)
    expect(screen.getByText('38')).toBeInTheDocument()
    expect(screen.getByText('40')).toBeInTheDocument()
    expect(screen.queryByText('76')).not.toBeInTheDocument()
  })

  it('returns null when breakdown is empty', () => {
    const { container } = render(<AnalysisBreakdownPanel breakdown={{}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
