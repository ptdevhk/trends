import { FacetGroup } from '@/components/search/FacetGroup'
import { Card, CardContent } from '@/components/ui/card'
import type { FacetCounts } from '@/components/search/search-types'
import type { ExperienceLevelFilter } from '@/hooks/useUrlSearchState'
import type { CandidateStatus } from '@/types/resume'

export type FacetSidebarProps = {
  embedded?: boolean
  facetCounts: FacetCounts
  minScore?: number
  selectedClusters: string[]
  selectedCompanies: string[]
  selectedEducation: string[]
  selectedExperienceLevel?: ExperienceLevelFilter
  selectedStatuses: CandidateStatus[]
  selectedTags: string[]
  onClearAll: () => void
  onSetExperienceLevel: (value: ExperienceLevelFilter | undefined) => void
  onSetMinScore: (value: number | undefined) => void
  onToggleCompany: (value: string) => void
  onToggleCluster: (value: string) => void
  onToggleEducation: (value: string) => void
  onToggleStatus: (value: CandidateStatus) => void
  onToggleTag: (value: string) => void
}

function ExperienceLevelGroup({
  selectedExperienceLevel,
  onSetExperienceLevel,
}: Pick<FacetSidebarProps, 'selectedExperienceLevel' | 'onSetExperienceLevel'>) {
  const items = [
    { value: 'senior', label: 'Senior' },
    { value: 'mid', label: 'Mid' },
    { value: 'junior', label: 'Junior' },
  ] as const

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
        Experience level
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const active = selectedExperienceLevel === item.value
          return (
            <button
              key={item.value}
              type="button"
              className={active
                ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1.5 text-sm text-white'
                : 'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700'}
              onClick={() => onSetExperienceLevel(active ? undefined : item.value)}
            >
              {item.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function FacetSidebar({
  embedded = false,
  facetCounts,
  minScore,
  selectedClusters,
  selectedCompanies,
  selectedEducation,
  selectedExperienceLevel,
  selectedStatuses,
  selectedTags,
  onClearAll,
  onSetExperienceLevel,
  onSetMinScore,
  onToggleCompany,
  onToggleCluster,
  onToggleEducation,
  onToggleStatus,
  onToggleTag,
}: FacetSidebarProps) {
  const content = (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900">Filters</div>
          <div className="text-xs text-muted-foreground">Refine the current result set without leaving the search flow.</div>
        </div>
        <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={onClearAll}>
          Reset
        </button>
      </div>

      <FacetGroup
        title="Skill Clusters"
        items={facetCounts.clusters}
        selectedValues={selectedClusters}
        onToggle={onToggleCluster}
      />
      <FacetGroup title="Tags" items={facetCounts.tags} selectedValues={selectedTags} onToggle={onToggleTag} />
      <FacetGroup title="Companies" items={facetCounts.companies} selectedValues={selectedCompanies} onToggle={onToggleCompany} />
      <ExperienceLevelGroup selectedExperienceLevel={selectedExperienceLevel} onSetExperienceLevel={onSetExperienceLevel} />
      <FacetGroup title="Education" items={facetCounts.education} selectedValues={selectedEducation} onToggle={onToggleEducation} />
      <FacetGroup title="Status" items={facetCounts.statuses} selectedValues={selectedStatuses} onToggle={(value) => onToggleStatus(value as CandidateStatus)} />
      <FacetGroup
        title="Match score"
        items={facetCounts.minScoreOptions.map((item) => ({ ...item, value: `${item.value}+` }))}
        selectedValues={typeof minScore === 'number' ? [`${minScore}+`] : []}
        onToggle={(value) => {
          const numericValue = Number(value.replace('+', ''))
          onSetMinScore(minScore === numericValue ? undefined : numericValue)
        }}
      />
    </div>
  )

  if (embedded) {
    return content
  }

  return (
    <Card className="rounded-[1.75rem] border-slate-200 bg-white">
      <CardContent className="p-5">
        {content}
      </CardContent>
    </Card>
  )
}
