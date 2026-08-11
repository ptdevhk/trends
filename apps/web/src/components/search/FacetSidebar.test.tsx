import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FacetSidebar } from '@/components/search/FacetSidebar'
import type { FacetCounts } from '@/components/search/search-types'
import type { CandidateStatus } from '@/types/resume'

const mockT = (key: string, options?: string | Record<string, string | number | undefined>) => {
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
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
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
    brands: [],
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
        selectedBrands={[]}
        selectedClusters={[]}
        selectedCompanies={[]}
        selectedEducation={[]}
        selectedStatuses={[]}
        selectedTags={[]}
        onClearAll={onClearAll}
        onSetExperienceLevel={vi.fn()}
        onSetMinRoleYears={vi.fn()}
        onSetAgeRange={vi.fn()}
        onSetMinScore={vi.fn()}
        onSetSalaryRange={vi.fn()}
        onToggleBrand={vi.fn()}
        onToggleCluster={vi.fn()}
        onToggleCompany={vi.fn()}
        onToggleEducation={vi.fn()}
        onToggleStatus={vi.fn()}
        onToggleTag={vi.fn()}
        selectedSources={[]}
        onToggleSource={vi.fn()}
        onSetIdOrNameSearch={vi.fn()}
      />
    )

    expect(container.firstElementChild).toHaveClass('space-y-6')
    expect(container.firstElementChild).not.toHaveClass('rounded-[1.75rem]')
    expect(screen.getByText('Refine the currently loaded search results.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reset' }))

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
        selectedBrands={[]}
        selectedClusters={['manufacturing-systems']}
        selectedCompanies={[]}
        selectedEducation={['Bachelor']}
        selectedStatuses={['new']}
        selectedTags={['machine tools']}
        onClearAll={onClearAll}
        onSetExperienceLevel={vi.fn()}
        onSetMinRoleYears={vi.fn()}
        onSetAgeRange={vi.fn()}
        onSetMinScore={vi.fn()}
        onSetSalaryRange={vi.fn()}
        onToggleBrand={vi.fn()}
        onToggleCluster={onToggleCluster}
        onToggleCompany={onToggleCompany}
        onToggleEducation={onToggleEducation}
        onToggleStatus={onToggleStatus}
        onToggleTag={onToggleTag}
        selectedSources={[]}
        onToggleSource={vi.fn()}
        onSetIdOrNameSearch={vi.fn()}
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

  it('renders the primary screening filters before secondary facets', () => {
    const { container } = render(
      <FacetSidebar
        facetCounts={buildFacetCounts()}
        selectedBrands={[]}
        selectedClusters={[]}
        selectedCompanies={[]}
        selectedEducation={[]}
        selectedStatuses={[]}
        selectedTags={[]}
        onClearAll={vi.fn()}
        onSetExperienceLevel={vi.fn()}
        onSetMinRoleYears={vi.fn()}
        onSetAgeRange={vi.fn()}
        onSetMinScore={vi.fn()}
        onSetSalaryRange={vi.fn()}
        onToggleBrand={vi.fn()}
        onToggleCluster={vi.fn()}
        onToggleCompany={vi.fn()}
        onToggleEducation={vi.fn()}
        onToggleStatus={vi.fn()}
        onToggleTag={vi.fn()}
        selectedSources={[]}
        onToggleSource={vi.fn()}
        onSetIdOrNameSearch={vi.fn()}
      />
    )

    expect(screen.getByPlaceholderText('ID / Name / External ID')).toBeInTheDocument()

    const renderedText = container.textContent ?? ''
    const primaryLabels = [
      'Candidate Status',
      'Match Score',
      'Relevant Experience',
      'Age Range',
      'Expected Salary',
    ]
    const labelPositions = primaryLabels.map((label) => renderedText.indexOf(label))
    const firstSecondaryFacetPosition = renderedText.indexOf('Skill Clusters')

    expect(labelPositions).not.toContain(-1)
    expect(labelPositions).toEqual([...labelPositions].sort((left, right) => left - right))
    expect(firstSecondaryFacetPosition).toBeGreaterThan(labelPositions[labelPositions.length - 1] ?? -1)
  })

  it('toggles experience level and minimum score filters', async () => {
    const user = userEvent.setup()
    const onSetExperienceLevel = vi.fn()
    const onSetMinScore = vi.fn()

    render(
      <FacetSidebar
        facetCounts={buildFacetCounts()}
        minScore={80}
        selectedBrands={[]}
        selectedClusters={[]}
        selectedCompanies={[]}
        selectedEducation={[]}
        selectedExperienceLevel="senior"
        selectedStatuses={[]}
        selectedTags={[]}
        onClearAll={vi.fn()}
        onSetExperienceLevel={onSetExperienceLevel}
        onSetMinRoleYears={vi.fn()}
        onSetAgeRange={vi.fn()}
        onSetMinScore={onSetMinScore}
        onSetSalaryRange={vi.fn()}
        onToggleBrand={vi.fn()}
        onToggleCluster={vi.fn()}
        onToggleCompany={vi.fn()}
        onToggleEducation={vi.fn()}
        onToggleStatus={vi.fn()}
        onToggleTag={vi.fn()}
        selectedSources={[]}
        onToggleSource={vi.fn()}
        onSetIdOrNameSearch={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Senior' }))
    await user.click(screen.getByRole('button', { name: 'Mid-level' }))
    await user.click(screen.getByRole('button', { name: /80\+/i }))
    await user.click(screen.getByRole('button', { name: /70\+/i }))

    expect(onSetExperienceLevel).toHaveBeenNthCalledWith(1, undefined)
    expect(onSetExperienceLevel).toHaveBeenNthCalledWith(2, 'mid')
    expect(onSetMinScore).toHaveBeenNthCalledWith(1, undefined)
    expect(onSetMinScore).toHaveBeenNthCalledWith(2, 70)
  })

  it('toggles minRoleYears filter pills', async () => {
    const user = userEvent.setup()
    const onSetMinRoleYears = vi.fn()

    render(
      <FacetSidebar
        facetCounts={buildFacetCounts()}
        minRoleYears={2}
        selectedBrands={[]}
        selectedClusters={[]}
        selectedCompanies={[]}
        selectedEducation={[]}
        selectedStatuses={[]}
        selectedTags={[]}
        onClearAll={vi.fn()}
        onSetExperienceLevel={vi.fn()}
        onSetMinRoleYears={onSetMinRoleYears}
        onSetAgeRange={vi.fn()}
        onSetMinScore={vi.fn()}
        onSetSalaryRange={vi.fn()}
        onToggleBrand={vi.fn()}
        onToggleCluster={vi.fn()}
        onToggleCompany={vi.fn()}
        onToggleEducation={vi.fn()}
        onToggleStatus={vi.fn()}
        onToggleTag={vi.fn()}
        selectedSources={[]}
        onToggleSource={vi.fn()}
        onSetIdOrNameSearch={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: '2+' })).toHaveClass('bg-slate-900')

    await user.click(screen.getByRole('button', { name: '2+' }))
    expect(onSetMinRoleYears).toHaveBeenCalledWith(undefined)

    await user.click(screen.getByRole('button', { name: '5+' }))
    expect(onSetMinRoleYears).toHaveBeenCalledWith(5)
  })

  it('supports custom minRoleYears input', async () => {
    const user = userEvent.setup()
    const onSetMinRoleYears = vi.fn()

    render(
      <FacetSidebar
        facetCounts={buildFacetCounts()}
        selectedBrands={[]}
        selectedClusters={[]}
        selectedCompanies={[]}
        selectedEducation={[]}
        selectedStatuses={[]}
        selectedTags={[]}
        onClearAll={vi.fn()}
        onSetExperienceLevel={vi.fn()}
        onSetMinRoleYears={onSetMinRoleYears}
        onSetAgeRange={vi.fn()}
        onSetMinScore={vi.fn()}
        onSetSalaryRange={vi.fn()}
        onToggleBrand={vi.fn()}
        onToggleCluster={vi.fn()}
        onToggleCompany={vi.fn()}
        onToggleEducation={vi.fn()}
        onToggleStatus={vi.fn()}
        onToggleTag={vi.fn()}
        selectedSources={[]}
        onToggleSource={vi.fn()}
        onSetIdOrNameSearch={vi.fn()}
      />
    )

    // Click the "Custom" button within the minRoleYears section (first one)
    const customButtons = screen.getAllByRole('button', { name: /Custom/i })
    await user.click(customButtons[0])
    const inputs = screen.getAllByRole('spinbutton')
    const input = inputs[0]
    expect(input).toBeInTheDocument()

    // Type a custom value and press Enter to submit
    await user.type(input, '10')
    await user.keyboard('{Enter}')

    expect(onSetMinRoleYears).toHaveBeenCalledWith(10)
  })

  it('toggles age range filter pills', async () => {
    const user = userEvent.setup()
    const onSetAgeRange = vi.fn()

    render(
      <FacetSidebar
        facetCounts={buildFacetCounts()}
        selectedBrands={[]}
        selectedClusters={[]}
        selectedCompanies={[]}
        selectedEducation={[]}
        selectedStatuses={[]}
        selectedTags={[]}
        onClearAll={vi.fn()}
        onSetAgeRange={onSetAgeRange}
        onSetExperienceLevel={vi.fn()}
        onSetMinRoleYears={vi.fn()}
        onSetMinScore={vi.fn()}
        onSetSalaryRange={vi.fn()}
        onToggleBrand={vi.fn()}
        onToggleCluster={vi.fn()}
        onToggleCompany={vi.fn()}
        onToggleEducation={vi.fn()}
        onToggleStatus={vi.fn()}
        onToggleTag={vi.fn()}
        selectedSources={[]}
        onToggleSource={vi.fn()}
        onSetIdOrNameSearch={vi.fn()}
      />
    )

    // Click 25-40 preset
    await user.click(screen.getByRole('button', { name: '25-40' }))
    expect(onSetAgeRange).toHaveBeenCalledWith(25, 40)

    // Click 25+ preset
    onSetAgeRange.mockClear()
    await user.click(screen.getByRole('button', { name: '25+' }))
    expect(onSetAgeRange).toHaveBeenCalledWith(25, undefined)

    // Click ≤40 preset
    onSetAgeRange.mockClear()
    await user.click(screen.getByRole('button', { name: '≤40' }))
    expect(onSetAgeRange).toHaveBeenCalledWith(undefined, 40)
  })

  it('deselects age range pill on re-click', async () => {
    const user = userEvent.setup()
    const onSetAgeRange = vi.fn()

    render(
      <FacetSidebar
        minAge={25}
        maxAge={40}
        facetCounts={buildFacetCounts()}
        selectedBrands={[]}
        selectedClusters={[]}
        selectedCompanies={[]}
        selectedEducation={[]}
        selectedStatuses={[]}
        selectedTags={[]}
        onClearAll={vi.fn()}
        onSetAgeRange={onSetAgeRange}
        onSetExperienceLevel={vi.fn()}
        onSetMinRoleYears={vi.fn()}
        onSetMinScore={vi.fn()}
        onSetSalaryRange={vi.fn()}
        onToggleBrand={vi.fn()}
        onToggleCluster={vi.fn()}
        onToggleCompany={vi.fn()}
        onToggleEducation={vi.fn()}
        onToggleStatus={vi.fn()}
        onToggleTag={vi.fn()}
        selectedSources={[]}
        onToggleSource={vi.fn()}
        onSetIdOrNameSearch={vi.fn()}
      />
    )

    // Active pill should have dark style
    expect(screen.getByRole('button', { name: '25-40' })).toHaveClass('bg-slate-900')

    // Re-click deselects
    await user.click(screen.getByRole('button', { name: '25-40' }))
    expect(onSetAgeRange).toHaveBeenCalledWith(undefined, undefined)
  })
})

describe('idOrNameSearch filter input', () => {
  function buildProps() {
    return {
      facetCounts: buildFacetCounts(),
      selectedBrands: [],
      selectedClusters: [],
      selectedCompanies: [],
      selectedEducation: [],
      selectedExperienceLevel: undefined as undefined,
      selectedSources: [],
      selectedStatuses: [] as CandidateStatus[],
      selectedTags: [],
      onClearAll: vi.fn(),
      onSetAgeRange: vi.fn(),
      onSetExperienceLevel: vi.fn(),
      onSetMinRoleYears: vi.fn(),
      onSetMinScore: vi.fn(),
      onSetSalaryRange: vi.fn(),
      onToggleBrand: vi.fn(),
      onToggleCluster: vi.fn(),
      onToggleCompany: vi.fn(),
      onToggleEducation: vi.fn(),
      onToggleSource: vi.fn(),
      onToggleStatus: vi.fn(),
      onToggleTag: vi.fn(),
      idOrNameSearch: undefined as string | undefined,
      onSetIdOrNameSearch: vi.fn(),
    }
  }

  it('renders the id/name search input placeholder', () => {
    render(<FacetSidebar {...buildProps()} embedded />)
    expect(screen.getByPlaceholderText('ID / Name / External ID')).toBeInTheDocument()
  })

  it('shows current idOrNameSearch value', () => {
    render(<FacetSidebar {...buildProps()} embedded idOrNameSearch="abc123" />)
    expect(screen.getByDisplayValue('abc123')).toBeInTheDocument()
  })

  it('calls onSetIdOrNameSearch when typing', async () => {
    const user = userEvent.setup()
    const onSetIdOrNameSearch = vi.fn()
    render(<FacetSidebar {...buildProps()} embedded onSetIdOrNameSearch={onSetIdOrNameSearch} />)
    const input = screen.getByPlaceholderText('ID / Name / External ID')
    await user.type(input, 'x')
    expect(onSetIdOrNameSearch).toHaveBeenCalledWith('x')
  })

  it('shows clear button only when value present', () => {
    const { rerender } = render(<FacetSidebar {...buildProps()} embedded idOrNameSearch={undefined} />)
    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument()

    rerender(<FacetSidebar {...buildProps()} embedded idOrNameSearch="abc" />)
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument()
  })

  it('calls onSetIdOrNameSearch with undefined when clear button clicked', async () => {
    const user = userEvent.setup()
    const onSetIdOrNameSearch = vi.fn()
    render(<FacetSidebar {...buildProps()} embedded idOrNameSearch="abc" onSetIdOrNameSearch={onSetIdOrNameSearch} />)
    await user.click(screen.getByRole('button', { name: /clear/i }))
    expect(onSetIdOrNameSearch).toHaveBeenCalledWith(undefined)
  })
})
