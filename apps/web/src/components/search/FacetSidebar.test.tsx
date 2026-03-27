import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FacetSidebar } from '@/components/search/FacetSidebar'
import type { FacetCounts } from '@/components/search/search-types'

function buildFacetCounts(): FacetCounts {
  return {
    clusters: [
      { value: 'manufacturing-systems', label: 'Manufacturing Systems', count: 4 },
    ],
    tags: [
      { value: 'Machine Tools', count: 12 },
      { value: 'Automation', count: 7 },
      { value: 'Servo', count: 5 },
      { value: 'Robotics', count: 4 },
      { value: 'PLC', count: 4 },
      { value: 'CNC', count: 3 },
      { value: 'Servo Drives', count: 2 },
      { value: 'Siemens', count: 2 },
      { value: 'Mitsubishi', count: 1 },
    ],
    companies: [
      { value: 'FANUC', count: 3 },
    ],
    experienceLevels: [
      { value: 'senior', count: 5 },
    ],
    education: [
      { value: 'Bachelor', count: 6 },
    ],
    statuses: [
      { value: 'new', count: 8 },
    ],
    minScoreOptions: [
      { value: '60', count: 8 },
      { value: '70', count: 5 },
      { value: '80', count: 2 },
    ],
  }
}

describe('FacetSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards reset and filter toggle actions', async () => {
    const user = userEvent.setup()
    const onClearAll = vi.fn()
    const onToggleCluster = vi.fn()
    const onToggleTag = vi.fn()
    const onToggleCompany = vi.fn()
    const onToggleEducation = vi.fn()
    const onToggleStatus = vi.fn()

    render(
      <FacetSidebar
        facetCounts={buildFacetCounts()}
        selectedClusters={['manufacturing-systems']}
        selectedCompanies={[]}
        selectedEducation={['Bachelor']}
        selectedStatuses={['new']}
        selectedTags={['machine tools']}
        onClearAll={onClearAll}
        onSetExperienceLevel={vi.fn()}
        onSetMinScore={vi.fn()}
        onToggleCluster={onToggleCluster}
        onToggleCompany={onToggleCompany}
        onToggleEducation={onToggleEducation}
        onToggleStatus={onToggleStatus}
        onToggleTag={onToggleTag}
      />
    )

    expect(screen.getByRole('button', { name: /Machine Tools/i })).toHaveClass('bg-slate-900')
    expect(screen.getByRole('button', { name: /Show 1 more/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reset' }))
    await user.click(screen.getByRole('button', { name: /Manufacturing Systems/i }))
    await user.click(screen.getByRole('button', { name: /Machine Tools/i }))
    await user.click(screen.getByRole('button', { name: /FANUC/i }))
    await user.click(screen.getByRole('button', { name: /Bachelor/i }))
    await user.click(screen.getByRole('button', { name: /new/i }))

    expect(onClearAll).toHaveBeenCalled()
    expect(onToggleCluster).toHaveBeenCalledWith('manufacturing-systems')
    expect(onToggleTag).toHaveBeenCalledWith('Machine Tools')
    expect(onToggleCompany).toHaveBeenCalledWith('FANUC')
    expect(onToggleEducation).toHaveBeenCalledWith('Bachelor')
    expect(onToggleStatus).toHaveBeenCalledWith('new')
  })

  it('toggles experience level and minimum score filters', async () => {
    const user = userEvent.setup()
    const onSetExperienceLevel = vi.fn()
    const onSetMinScore = vi.fn()

    render(
      <FacetSidebar
        facetCounts={buildFacetCounts()}
        minScore={80}
        selectedClusters={[]}
        selectedCompanies={[]}
        selectedEducation={[]}
        selectedExperienceLevel="senior"
        selectedStatuses={[]}
        selectedTags={[]}
        onClearAll={vi.fn()}
        onSetExperienceLevel={onSetExperienceLevel}
        onSetMinScore={onSetMinScore}
        onToggleCluster={vi.fn()}
        onToggleCompany={vi.fn()}
        onToggleEducation={vi.fn()}
        onToggleStatus={vi.fn()}
        onToggleTag={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Senior' }))
    await user.click(screen.getByRole('button', { name: 'Mid' }))
    await user.click(screen.getByRole('button', { name: /80\+/i }))
    await user.click(screen.getByRole('button', { name: /70\+/i }))

    expect(onSetExperienceLevel).toHaveBeenNthCalledWith(1, undefined)
    expect(onSetExperienceLevel).toHaveBeenNthCalledWith(2, 'mid')
    expect(onSetMinScore).toHaveBeenNthCalledWith(1, undefined)
    expect(onSetMinScore).toHaveBeenNthCalledWith(2, 70)
  })
})
