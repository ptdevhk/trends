import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FacetSidebar } from '@/components/search/FacetSidebar'
import type { FacetCounts } from '@/components/search/search-types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, string | number | undefined>) => {
      if (typeof options === 'string') {
        return options
      }

      const defaultValue =
        options && typeof options === 'object' && typeof options.defaultValue === 'string'
          ? options.defaultValue
          : key

      return defaultValue.replace(/\{\{(\w+)\}\}/g, (_: string, token: string) => {
        const value = options && typeof options === 'object' ? options[token] : undefined
        return value === undefined || value === null ? '' : String(value)
      })
    },
  }),
}))

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
    sources: [],
  }
}

describe('FacetSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders bare embedded content without the desktop card wrapper', async () => {
    const user = userEvent.setup()
    const onClearAll = vi.fn()
    const { container } = render(
      <FacetSidebar
        embedded
        facetCounts={buildFacetCounts()}
        selectedClusters={[]}
        selectedCompanies={[]}
        selectedEducation={[]}
        selectedStatuses={[]}
        selectedTags={[]}
        onClearAll={onClearAll}
        onSetExperienceLevel={vi.fn()}
        onSetMinScore={vi.fn()}
        onToggleCluster={vi.fn()}
        onToggleCompany={vi.fn()}
        onToggleEducation={vi.fn()}
        onToggleStatus={vi.fn()}
        onToggleTag={vi.fn()}
        selectedSources={[]}
        onToggleSource={vi.fn()}
      />
    )

    expect(container.firstElementChild).toHaveClass('space-y-6')
    expect(container.firstElementChild).not.toHaveClass('rounded-[1.75rem]')
    expect(screen.getByText('在当前搜索结果中进一步精确筛选。')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重置' }))

    expect(onClearAll).toHaveBeenCalledTimes(1)
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
        selectedSources={[]}
        onToggleSource={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /Machine Tools/i })).toHaveClass('bg-slate-900')
    expect(screen.getByRole('button', { name: /展开剩余 1 项/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重置' }))
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
        selectedSources={[]}
        onToggleSource={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: '资深' }))
    await user.click(screen.getByRole('button', { name: '中级' }))
    await user.click(screen.getByRole('button', { name: /80\+/i }))
    await user.click(screen.getByRole('button', { name: /70\+/i }))

    expect(onSetExperienceLevel).toHaveBeenNthCalledWith(1, undefined)
    expect(onSetExperienceLevel).toHaveBeenNthCalledWith(2, 'mid')
    expect(onSetMinScore).toHaveBeenNthCalledWith(1, undefined)
    expect(onSetMinScore).toHaveBeenNthCalledWith(2, 70)
  })
})
