import { useCallback, useRef, useState } from 'react'
import { isImeComposition } from '@/lib/utils'
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
  isFilterTransitionPending?: boolean
  loadedCount?: number
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
  isFilterTransitionPending = false,
}: Pick<FacetSidebarProps, 'minRoleYears' | 'onSetMinRoleYears' | 'isFilterTransitionPending'>) {
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
        {t('resumes.searchPage.facets.minRoleYears', { defaultValue: 'Relevant Experience' })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {PRESET_ROLE_YEARS.map((value) => {
          const active = minRoleYears === value
          return (
            <button
              key={value}
              type="button"
              disabled={isFilterTransitionPending}
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
              aria-label={t('resumes.searchPage.facets.minRoleYearsInput', { defaultValue: 'Relevant experience (years)' })}
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
              aria-label={t('common.apply', { defaultValue: 'Apply' })}
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
              {t('resumes.searchPage.facets.custom', { defaultValue: 'Custom' })}
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
            {t('resumes.searchPage.facets.custom', { defaultValue: 'Custom' })}
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

  const closeCustomRange = useCallback(() => {
    setCustomOpen(false)
    setCustomMin('')
    setCustomMax('')
  }, [])

  const handleRangeBlur = useCallback(() => {
    requestAnimationFrame(() => {
      if (formRef.current && !formRef.current.contains(document.activeElement)) {
        closeCustomRange()
      }
    })
  }, [closeCustomRange])

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

  const handleRangeInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (isImeComposition(event)) return
      if (event.key === 'Enter') {
        event.preventDefault()
        submitCustomValues()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        closeCustomRange()
      }
    },
    [submitCustomValues, closeCustomRange],
  )

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
                closeCustomRange()
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
              aria-label={t('resumes.searchPage.facets.rangeMin', { label, defaultValue: 'Minimum' })}
              className="h-7 w-12 px-2 text-sm"
              value={customMin}
              onChange={(event) => setCustomMin(event.target.value)}
              onBlur={handleRangeBlur}
              onKeyDown={handleRangeInputKeyDown}
              autoFocus
            />
            <span className="text-sm text-slate-400">–</span>
            <Input
              ref={maxRef}
              type="number"
              min={1}
              placeholder="—"
              aria-label={t('resumes.searchPage.facets.rangeMax', { label, defaultValue: 'Maximum' })}
              className="h-7 w-12 px-2 text-sm"
              value={customMax}
              onChange={(event) => setCustomMax(event.target.value)}
              onBlur={handleRangeBlur}
              onKeyDown={handleRangeInputKeyDown}
            />
            <span className="text-sm text-slate-500">{unitSuffix}</span>
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              className="h-6 w-6 p-0 text-slate-500 hover:text-slate-700"
              aria-label={t('common.apply', { defaultValue: 'Apply' })}
            >
              <Check className="h-4 w-4" />
            </Button>
            <button
              type="button"
              className="rounded-full border border-dashed border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-500 hover:border-slate-400 hover:text-slate-600"
              onClick={closeCustomRange}
            >
              {t('resumes.searchPage.facets.custom', { defaultValue: 'Custom' })}
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
            {t('resumes.searchPage.facets.custom', { defaultValue: 'Custom' })}
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
  isFilterTransitionPending,
  loadedCount,
}: FacetSidebarProps) {
  const { t } = useTranslation()
  const content = (
    <div className="space-y-6">
      {loadedCount !== undefined && loadedCount > 0 && (
        <div className="text-xs text-muted-foreground">
          {t('resumes.searchPage.facets.loadedCount', {
            count: loadedCount,
            defaultValue: 'Facet counts are based on the first {{count}} loaded results.',
          })}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900">{t('resumes.searchPage.facets.filtersTitle', { defaultValue: 'Filters' })}</div>
          <div className="text-xs text-muted-foreground">{t('resumes.searchPage.facets.filtersDescription', { defaultValue: 'Refine the currently loaded search results.' })}</div>
        </div>
        <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={onClearAll}>
          {t('common.reset', { defaultValue: 'Reset' })}
        </button>
      </div>

      {/* Id / name search */}
      <div className="relative">
        <Input
          type="text"
          placeholder={t('resumes.searchPage.facets.idOrNamePlaceholder', { defaultValue: 'ID / Name / External ID' })}
          value={idOrNameSearch ?? ''}
          onChange={(e) => onSetIdOrNameSearch(e.target.value || undefined)}
          className="pr-7 text-sm"
        />
        {idOrNameSearch && (
          <button
            type="button"
            aria-label={t('common.clear', { defaultValue: 'Clear' })}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => onSetIdOrNameSearch(undefined)}
          >
            ×
          </button>
        )}
      </div>

      <FacetGroup title={t('resumes.searchPage.facets.status', { defaultValue: 'Candidate Status' })} items={facetCounts.statuses} selectedValues={selectedStatuses} onToggle={(value) => onToggleStatus(value as CandidateStatus)} />
      <FacetGroup
        title={t('resumes.searchPage.facets.matchScore', { defaultValue: 'Match Score' })}
        items={facetCounts.minScoreOptions.map((item) => ({ ...item, value: `${item.value}+` }))}
        selectedValues={typeof minScore === 'number' ? [`${minScore}+`] : []}
        onToggle={(value) => {
          const numericValue = Number(value.replace('+', ''))
          onSetMinScore(minScore === numericValue ? undefined : numericValue)
        }}
      />
      <MinRoleYearsGroup minRoleYears={minRoleYears} onSetMinRoleYears={onSetMinRoleYears} isFilterTransitionPending={isFilterTransitionPending} />
      <RangeFilterGroup
        presets={PRESET_AGE_RANGES}
        label={t('resumes.searchPage.facets.ageRange', { defaultValue: 'Age Range' })}
        unitSuffix={t('resumes.searchPage.facets.ageUnit', { defaultValue: 'years old' })}
        valueMin={minAge}
        valueMax={maxAge}
        onSetRange={onSetAgeRange}
      />
      <RangeFilterGroup
        presets={PRESET_SALARY_RANGES}
        label={t('resumes.searchPage.facets.salary', { defaultValue: 'Expected Salary' })}
        unitSuffix={t('resumes.searchPage.facets.salaryUnit', { defaultValue: 'k' })}
        valueMin={minSalary}
        valueMax={maxSalary}
        onSetRange={onSetSalaryRange}
      />
      <FacetGroup
        title={t('resumes.searchPage.facets.skillClusters', { defaultValue: 'Skill Clusters' })}
        items={facetCounts.clusters}
        selectedValues={selectedClusters}
        onToggle={onToggleCluster}
      />
      <FacetGroup title={t('resumes.searchPage.facets.tags', { defaultValue: 'Tag clusters' })} items={facetCounts.tags} selectedValues={selectedTags} onToggle={onToggleTag} />
      <FacetGroup title={t('resumes.searchPage.facets.brands', { defaultValue: 'Brand tags' })} items={facetCounts.brands} selectedValues={selectedBrands} onToggle={onToggleBrand} />
      <FacetGroup title={t('resumes.searchPage.facets.companies', { defaultValue: 'Company experience' })} items={facetCounts.companies} selectedValues={selectedCompanies} onToggle={onToggleCompany} />
      <FacetGroup title={t('resumes.searchPage.facets.sources', { defaultValue: 'Sources' })} items={facetCounts.sources} selectedValues={selectedSources} onToggle={onToggleSource} />
      <PillGroup
        label={t('resumes.searchPage.facets.experienceLevel', { defaultValue: 'Experience level' })}
        items={[
          { value: 'senior' as const, label: t('resumes.searchPage.facets.experience.senior', { defaultValue: 'Senior' }) },
          { value: 'mid' as const, label: t('resumes.searchPage.facets.experience.mid', { defaultValue: 'Mid-level' }) },
          { value: 'junior' as const, label: t('resumes.searchPage.facets.experience.junior', { defaultValue: 'Junior' }) },
        ]}
        selectedValue={selectedExperienceLevel}
        onSelect={onSetExperienceLevel}
      />
      <FacetGroup title={t('resumes.searchPage.facets.education', { defaultValue: 'Education' })} items={facetCounts.education} selectedValues={selectedEducation} onToggle={onToggleEducation} />
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
