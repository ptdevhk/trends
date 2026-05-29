import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FacetGroup } from '@/components/search/FacetGroup'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Check } from 'lucide-react'
import type { FacetCounts } from '@/components/search/search-types'
import type { ExperienceLevelFilter } from '@/hooks/useUrlSearchState'
import type { CandidateStatus } from '@/types/resume'

export type MinRoleYearsOption = 1 | 2 | 5

export type FacetSidebarProps = {
  embedded?: boolean
  facetCounts: FacetCounts
  minAge?: number
  maxAge?: number
  minScore?: number
  minRoleYears?: number
  minSalary?: number
  maxSalary?: number
  selectedBrands: string[]
  selectedClusters: string[]
  selectedCompanies: string[]
  selectedEducation: string[]
  selectedExperienceLevel?: ExperienceLevelFilter
  selectedSources: string[]
  selectedStatuses: CandidateStatus[]
  selectedTags: string[]
  onClearAll: () => void
  onSetAgeRange: (minAge: number | undefined, maxAge: number | undefined) => void
  onSetExperienceLevel: (value: ExperienceLevelFilter | undefined) => void
  onSetMinRoleYears: (value: number | undefined) => void
  onSetMinScore: (value: number | undefined) => void
  onSetSalaryRange: (minSalary: number | undefined, maxSalary: number | undefined) => void
  onToggleBrand: (value: string) => void
  onToggleCompany: (value: string) => void
  onToggleCluster: (value: string) => void
  onToggleEducation: (value: string) => void
  onToggleSource: (value: string) => void
  onToggleStatus: (value: CandidateStatus) => void
  onToggleTag: (value: string) => void
  idOrNameSearch?: string
  onSetIdOrNameSearch: (value: string | undefined) => void
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
  const formRef = useRef<HTMLFormElement>(null)

  const submitCustomValue = useCallback((rawValue: string) => {
    const parsed = Number(rawValue)
    if (rawValue.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
      setCustomOpen(false)
      setCustomText('')
      return
    }
    onSetMinRoleYears(parsed)
    setCustomOpen(false)
    setCustomText('')
  }, [onSetMinRoleYears])

  const handleBlur = useCallback(() => {
    requestAnimationFrame(() => {
      if (formRef.current && !formRef.current.contains(document.activeElement)) {
        setCustomOpen(false)
        setCustomText('')
      }
    })
  }, [])

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
            ref={formRef}
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
              onBlur={handleBlur}
              autoFocus
            />
            <span className="text-sm text-slate-500">+</span>
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              className="h-6 w-6 p-0 text-slate-500 hover:text-slate-700"
              aria-label={t('common.apply', { defaultValue: '应用' })}
            >
              <Check className="h-4 w-4" />
            </Button>
            <button
              type="button"
              className="rounded-full border border-dashed border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-500 hover:border-slate-400 hover:text-slate-600"
              onClick={() => {
                setCustomOpen(false)
                setCustomText('')
              }}
            >
              {t('resumes.searchPage.facets.custom', { defaultValue: '自定义' })}
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="rounded-full border border-dashed border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-500 hover:border-slate-400 hover:text-slate-600"
            onClick={() => {
              setCustomOpen(true)
            }}
          >
            {t('resumes.searchPage.facets.custom', { defaultValue: '自定义' })}
          </button>
        )}
      </div>
    </div>
  )
}

const PRESET_AGE_RANGES = [
  { min: 25, max: undefined as number | undefined },
  { min: 25, max: 40 },
  { min: undefined as number | undefined, max: 40 },
] as const

const PRESET_SALARY_RANGES = [
  { min: undefined as number | undefined, max: 10 },
  { min: undefined as number | undefined, max: 15 },
  { min: 10, max: 20 },
  { min: 15, max: 30 },
  { min: 20, max: undefined as number | undefined },
] as const

type RangePreset = { min: number | undefined; max: number | undefined }

function RangeFilterGroup({
  presets,
  label,
  unitSuffix,
  valueMin,
  valueMax,
  onSetRange,
}: {
  presets: readonly RangePreset[]
  label: string
  unitSuffix: string
  valueMin: number | undefined
  valueMax: number | undefined
  onSetRange: (min: number | undefined, max: number | undefined) => void
}) {
  const { t } = useTranslation()
  const activePreset = presets.find(
    (p) => p.min === valueMin && p.max === valueMax,
  )
  const [customOpen, setCustomOpen] = useState(!activePreset && (valueMin != null || valueMax != null))
  const [customMin, setCustomMin] = useState(activePreset || (valueMin == null && valueMax == null) ? '' : (typeof valueMin === 'number' ? String(valueMin) : ''))
  const [customMax, setCustomMax] = useState(activePreset || (valueMin == null && valueMax == null) ? '' : (typeof valueMax === 'number' ? String(valueMax) : ''))
  const minRef = useRef<HTMLInputElement>(null)
  const maxRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const handleRangeBlur = useCallback(() => {
    requestAnimationFrame(() => {
      if (formRef.current && !formRef.current.contains(document.activeElement)) {
        setCustomOpen(false)
        setCustomMin('')
        setCustomMax('')
      }
    })
  }, [])

  const submitCustomValues = useCallback(() => {
    const rawMin = minRef.current?.value ?? String(customMin)
    const rawMax = maxRef.current?.value ?? String(customMax)
    const parsedMin = rawMin.trim() === '' ? undefined : Number(rawMin)
    const parsedMax = rawMax.trim() === '' ? undefined : Number(rawMax)

    if (
      (parsedMin != null && (!Number.isFinite(parsedMin) || parsedMin <= 0)) ||
      (parsedMax != null && (!Number.isFinite(parsedMax) || parsedMax <= 0))
    ) {
      return
    }
    if (parsedMin != null && parsedMax != null && parsedMin > parsedMax) {
      return
    }
    if (parsedMin == null && parsedMax == null) {
      setCustomOpen(false)
      return
    }
    onSetRange(parsedMin, parsedMax)
    setCustomOpen(false)
  }, [customMin, customMax, onSetRange])

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {presets.map((preset) => {
          const active = activePreset === preset
          const presetLabel = `${preset.min ?? ''}-${preset.max ?? ''}`
            .replace(/^-/, '≤')
            .replace(/-$/, '+')
          return (
            <button
              key={presetLabel}
              type="button"
              className={active
                ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1.5 text-sm text-white'
                : 'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700'}
              onClick={() => {
                setCustomOpen(false)
                setCustomMin('')
                setCustomMax('')
                onSetRange(active ? undefined : preset.min, active ? undefined : preset.max)
              }}
            >
              {presetLabel}
            </button>
          )
        })}
        {customOpen ? (
          <form
            ref={formRef}
            className="inline-flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault()
              submitCustomValues()
            }}
          >
            <Input
              ref={minRef}
              type="number"
              min={1}
              placeholder="—"
              className="h-7 w-12 px-2 text-sm"
              value={customMin}
              onChange={(event) => setCustomMin(event.target.value)}
              onBlur={handleRangeBlur}
              onKeyDown={(e) => { if (e.key === 'Enter') submitCustomValues() }}
              autoFocus
            />
            <span className="text-sm text-slate-400">–</span>
            <Input
              ref={maxRef}
              type="number"
              min={1}
              placeholder="—"
              className="h-7 w-12 px-2 text-sm"
              value={customMax}
              onChange={(event) => setCustomMax(event.target.value)}
              onBlur={handleRangeBlur}
              onKeyDown={(e) => { if (e.key === 'Enter') submitCustomValues() }}
            />
            <span className="text-sm text-slate-500">{unitSuffix}</span>
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              className="h-6 w-6 p-0 text-slate-500 hover:text-slate-700"
              aria-label={t('common.apply', { defaultValue: '应用' })}
            >
              <Check className="h-4 w-4" />
            </Button>
            <button
              type="button"
              className="rounded-full border border-dashed border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-500 hover:border-slate-400 hover:text-slate-600"
              onClick={() => {
                setCustomOpen(false)
                setCustomMin('')
                setCustomMax('')
              }}
            >
              {t('resumes.searchPage.facets.custom', { defaultValue: '自定义' })}
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="rounded-full border border-dashed border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-500 hover:border-slate-400 hover:text-slate-600"
            onClick={() => {
              setCustomOpen(true)
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
  minAge,
  maxAge,
  minScore,
  minRoleYears,
  minSalary,
  maxSalary,
  selectedBrands,
  selectedClusters,
  selectedCompanies,
  selectedEducation,
  selectedExperienceLevel,
  selectedSources,
  selectedStatuses,
  selectedTags,
  onClearAll,
  onSetAgeRange,
  onSetExperienceLevel,
  onSetMinRoleYears,
  onSetMinScore,
  onSetSalaryRange,
  onToggleBrand,
  onToggleCompany,
  onToggleCluster,
  onToggleEducation,
  onToggleSource,
  onToggleStatus,
  onToggleTag,
  idOrNameSearch,
  onSetIdOrNameSearch,
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

      {/* Id / name search */}
      <div className="relative">
        <Input
          type="text"
          placeholder="ID · 候选人姓名"
          value={idOrNameSearch ?? ''}
          onChange={(e) => onSetIdOrNameSearch(e.target.value || undefined)}
          className="pr-7 text-sm"
        />
        {idOrNameSearch && (
          <button
            type="button"
            aria-label="clear"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => onSetIdOrNameSearch(undefined)}
          >
            ×
          </button>
        )}
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
      <RangeFilterGroup
        presets={PRESET_AGE_RANGES}
        label={t('resumes.searchPage.facets.ageRange', { defaultValue: '年龄范围' })}
        unitSuffix={t('resumes.searchPage.facets.ageUnit', { defaultValue: '岁' })}
        valueMin={minAge}
        valueMax={maxAge}
        onSetRange={onSetAgeRange}
      />
      <RangeFilterGroup
        presets={PRESET_SALARY_RANGES}
        label={t('resumes.searchPage.facets.salary', { defaultValue: '期望薪资' })}
        unitSuffix={t('resumes.searchPage.facets.salaryUnit', { defaultValue: 'k' })}
        valueMin={minSalary}
        valueMax={maxSalary}
        onSetRange={onSetSalaryRange}
      />
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
