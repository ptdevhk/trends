import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FacetGroup } from '@/components/search/FacetGroup'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { FacetCounts } from '@/components/search/search-types'
import type { ExperienceLevelFilter } from '@/hooks/useUrlSearchState'
import type { CandidateStatus } from '@/types/resume'

export type MinRoleYearsOption = 1 | 2 | 5

export type FacetSidebarProps = {
  embedded?: boolean
  facetCounts: FacetCounts
  minScore?: number
  minRoleYears?: number
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
  onSetMinRoleYears: (value: number | undefined) => void
  onSetMinScore: (value: number | undefined) => void
  onToggleBrand: (value: string) => void
  onToggleCompany: (value: string) => void
  onToggleCluster: (value: string) => void
  onToggleEducation: (value: string) => void
  onToggleSource: (value: string) => void
  onToggleStatus: (value: CandidateStatus) => void
  onToggleTag: (value: string) => void
}

function PillGroup<T extends string | number>({
  label,
  items,
  selectedValue,
  onSelect,
}: {
  label: string
  items: readonly { value: T; label: string }[]
  selectedValue: T | undefined
  onSelect: (value: T | undefined) => void
}) {
  return (
    <div className="space-y-3">
      <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const active = selectedValue === item.value
          return (
            <button
              key={String(item.value)}
              type="button"
              className={active
                ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1.5 text-sm text-white'
                : 'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700'}
              onClick={() => onSelect(active ? undefined : item.value)}
            >
              {item.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const PRESET_ROLE_YEARS = [1, 2, 5] as const

function MinRoleYearsGroup({
  minRoleYears,
  onSetMinRoleYears,
}: Pick<FacetSidebarProps, 'minRoleYears' | 'onSetMinRoleYears'>) {
  const { t } = useTranslation()
  const isPreset = typeof minRoleYears === 'number' && (PRESET_ROLE_YEARS as readonly number[]).includes(minRoleYears)
  const [customOpen, setCustomOpen] = useState(typeof minRoleYears === 'number' && !isPreset)
  const [customText, setCustomText] = useState(isPreset || minRoleYears == null ? '' : String(minRoleYears))
  const inputRef = useRef<HTMLInputElement>(null)

  const submitCustomValue = useCallback((rawValue: string) => {
    const parsed = Number(rawValue)
    if (rawValue.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
      onSetMinRoleYears(undefined)
      setCustomOpen(false)
      setCustomText('')
      return
    }
    onSetMinRoleYears(parsed)
  }, [onSetMinRoleYears])

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {t('resumes.searchPage.facets.minRoleYears', { defaultValue: '岗位年限' })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {PRESET_ROLE_YEARS.map((value) => {
          const active = minRoleYears === value
          return (
            <button
              key={value}
              type="button"
              className={active
                ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1.5 text-sm text-white'
                : 'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700'}
              onClick={() => {
                setCustomOpen(false)
                setCustomText('')
                onSetMinRoleYears(active ? undefined : value)
              }}
            >
              {value}+
            </button>
          )
        })}
        {customOpen ? (
          <form
            className="inline-flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault()
              submitCustomValue(inputRef.current?.value ?? customText)
            }}
          >
            <Input
              ref={inputRef}
              type="number"
              min={1}
              className="h-7 w-14 px-2 text-sm"
              value={customText}
              onChange={(event) => setCustomText(event.target.value)}
              onBlur={() => submitCustomValue(inputRef.current?.value ?? customText)}
              autoFocus
            />
            <span className="text-sm text-slate-500">+</span>
          </form>
        ) : (
          <button
            type="button"
            className="rounded-full border border-dashed border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-500 hover:border-slate-400 hover:text-slate-600"
            onClick={() => {
              setCustomOpen(true)
              onSetMinRoleYears(undefined)
            }}
          >
            {t('resumes.searchPage.facets.custom', { defaultValue: '自定义' })}
          </button>
        )}
      </div>
    </div>
  )
}

export function FacetSidebar({
  embedded = false,
  facetCounts,
  minScore,
  minRoleYears,
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
  onSetMinRoleYears,
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
      <PillGroup
        label={t('resumes.searchPage.facets.experienceLevel', { defaultValue: '工作经验' })}
        items={[
          { value: 'senior' as const, label: t('resumes.searchPage.facets.experience.senior', { defaultValue: '资深' }) },
          { value: 'mid' as const, label: t('resumes.searchPage.facets.experience.mid', { defaultValue: '中级' }) },
          { value: 'junior' as const, label: t('resumes.searchPage.facets.experience.junior', { defaultValue: '初级' }) },
        ]}
        selectedValue={selectedExperienceLevel}
        onSelect={onSetExperienceLevel}
      />
      <MinRoleYearsGroup minRoleYears={minRoleYears} onSetMinRoleYears={onSetMinRoleYears} />
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
