import { useTranslation } from 'react-i18next'
import { FacetGroup } from '@/components/search/FacetGroup'
import { Card, CardContent } from '@/components/ui/card'
import type { FacetCounts } from '@/components/search/search-types'
import type { ExperienceLevelFilter } from '@/hooks/useUrlSearchState'
import type { CandidateStatus } from '@/types/resume'

export type FacetSidebarProps = {
  embedded?: boolean
  facetCounts: FacetCounts
  minScore?: number
  selectedBrands: string[]
  selectedClusters: string[]
  selectedCompanies: string[]
  selectedEducation: string[]
  selectedExperienceLevel?: ExperienceLevelFilter
  selectedSources: string[]
  selectedStatuses: CandidateStatus[]
  selectedTags: string[]
  onClearAll: () => void
  onSetExperienceLevel: (value: ExperienceLevelFilter | undefined) => void
  onSetMinScore: (value: number | undefined) => void
  onToggleBrand: (value: string) => void
  onToggleCompany: (value: string) => void
  onToggleCluster: (value: string) => void
  onToggleEducation: (value: string) => void
  onToggleSource: (value: string) => void
  onToggleStatus: (value: CandidateStatus) => void
  onToggleTag: (value: string) => void
}

function ExperienceLevelGroup({
  selectedExperienceLevel,
  onSetExperienceLevel,
}: Pick<FacetSidebarProps, 'selectedExperienceLevel' | 'onSetExperienceLevel'>) {
  const { t } = useTranslation()
  const items = [
    { value: 'senior', label: t('resumes.searchPage.facets.experience.senior', { defaultValue: '资深' }) },
    { value: 'mid', label: t('resumes.searchPage.facets.experience.mid', { defaultValue: '中级' }) },
    { value: 'junior', label: t('resumes.searchPage.facets.experience.junior', { defaultValue: '初级' }) },
  ] as const

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {t('resumes.searchPage.facets.experienceLevel', { defaultValue: '工作经验' })}
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
  selectedBrands,
  selectedClusters,
  selectedCompanies,
  selectedEducation,
  selectedExperienceLevel,
  selectedSources,
  selectedStatuses,
  selectedTags,
  onClearAll,
  onSetExperienceLevel,
  onSetMinScore,
  onToggleBrand,
  onToggleCompany,
  onToggleCluster,
  onToggleEducation,
  onToggleSource,
  onToggleStatus,
  onToggleTag,
}: FacetSidebarProps) {
  const { t } = useTranslation()
  const content = (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900">{t('resumes.searchPage.facets.filtersTitle', { defaultValue: '筛选条件' })}</div>
          <div className="text-xs text-muted-foreground">{t('resumes.searchPage.facets.filtersDescription', { defaultValue: '在当前搜索结果中进一步精确筛选。' })}</div>
        </div>
        <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={onClearAll}>
          {t('common.reset', { defaultValue: '重置' })}
        </button>
      </div>

      <FacetGroup
        title={t('resumes.searchPage.facets.matchScore', { defaultValue: '匹配分' })}
        items={facetCounts.minScoreOptions.map((item) => ({ ...item, value: `${item.value}+` }))}
        selectedValues={typeof minScore === 'number' ? [`${minScore}+`] : []}
        onToggle={(value) => {
          const numericValue = Number(value.replace('+', ''))
          onSetMinScore(minScore === numericValue ? undefined : numericValue)
        }}
      />
      <FacetGroup
        title={t('resumes.searchPage.facets.skillClusters', { defaultValue: '技能图谱' })}
        items={facetCounts.clusters}
        selectedValues={selectedClusters}
        onToggle={onToggleCluster}
      />
      <FacetGroup title={t('resumes.searchPage.facets.tags', { defaultValue: '标签聚类' })} items={facetCounts.tags} selectedValues={selectedTags} onToggle={onToggleTag} />
      <FacetGroup title={t('resumes.searchPage.facets.brands', { defaultValue: '品牌标签' })} items={facetCounts.brands} selectedValues={selectedBrands} onToggle={onToggleBrand} />
      <FacetGroup title={t('resumes.searchPage.facets.companies', { defaultValue: '公司经历' })} items={facetCounts.companies} selectedValues={selectedCompanies} onToggle={onToggleCompany} />
      <FacetGroup title={t('resumes.searchPage.facets.sources', { defaultValue: '来源渠道' })} items={facetCounts.sources} selectedValues={selectedSources} onToggle={onToggleSource} />
      <ExperienceLevelGroup selectedExperienceLevel={selectedExperienceLevel} onSetExperienceLevel={onSetExperienceLevel} />
      <FacetGroup title={t('resumes.searchPage.facets.education', { defaultValue: '学历' })} items={facetCounts.education} selectedValues={selectedEducation} onToggle={onToggleEducation} />
      <FacetGroup title={t('resumes.searchPage.facets.status', { defaultValue: '候选人状态' })} items={facetCounts.statuses} selectedValues={selectedStatuses} onToggle={(value) => onToggleStatus(value as CandidateStatus)} />
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
