import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CandidateStatus, ResumeFilters } from '@/types/resume'

interface FilterPanelProps {
  filters: ResumeFilters
  onFiltersChange: (filters: ResumeFilters) => void
  mode?: 'ai' | 'original'
  className?: string
  defaultCollapsed?: boolean
  headerAction?: React.ReactNode
}

const EDUCATION_LEVELS = [
  { value: 'high_school', labelKey: 'resumes.filters.education.high_school' },
  { value: 'associate', labelKey: 'resumes.filters.education.associate' },
  { value: 'bachelor', labelKey: 'resumes.filters.education.bachelor' },
  { value: 'master', labelKey: 'resumes.filters.education.master' },
  { value: 'phd', labelKey: 'resumes.filters.education.phd' },
]

const STATUS_OPTIONS: Array<{ value: CandidateStatus; labelKey: string }> = [
  { value: 'new', labelKey: 'resumes.status.options.new' },
  { value: 'contacted', labelKey: 'resumes.status.options.contacted' },
  { value: 'interviewing', labelKey: 'resumes.status.options.interviewing' },
  { value: 'interviewed_pass', labelKey: 'resumes.status.options.interviewed_pass' },
  { value: 'interviewed_reject', labelKey: 'resumes.status.options.interviewed_reject' },
  { value: 'offer', labelKey: 'resumes.status.options.offer' },
  { value: 'hired', labelKey: 'resumes.status.options.hired' },
  { value: 'withdrawn', labelKey: 'resumes.status.options.withdrawn' },
]

export function FilterPanel({
  filters,
  onFiltersChange,
  mode = 'original',
  className,
  defaultCollapsed = false,
  headerAction,
}: FilterPanelProps) {
  const { t } = useTranslation()
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)

  const [minExperience, setMinExperience] = useState('')
  const [maxExperience, setMaxExperience] = useState('')
  const [minAge, setMinAge] = useState('')
  const [maxAge, setMaxAge] = useState('')
  const [minMatchScore, setMinMatchScore] = useState('')
  const [skills, setSkills] = useState('')
  const [locations, setLocations] = useState('')
  const [education, setEducation] = useState<string[]>([])
  const [status, setStatus] = useState<CandidateStatus[]>([])
  const [showBlocked, setShowBlocked] = useState(false)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    setMinExperience(filters.minExperience?.toString() ?? '')
    setMaxExperience(filters.maxExperience?.toString() ?? '')
    setMinAge(filters.minAge?.toString() ?? '')
    setMaxAge(filters.maxAge?.toString() ?? '')
    setMinMatchScore(filters.minMatchScore?.toString() ?? '')
    setSkills(filters.skills?.join(',') ?? '')
    setLocations(filters.locations?.join(',') ?? '')
    setEducation(filters.education ?? [])
    setStatus(filters.status ?? [])
    setShowBlocked(filters.showBlocked === true)
  }, [filters])

  const activeFilterBadges = useMemo(() => {
    const items: string[] = []

    if (filters.minExperience || filters.maxExperience) {
      if (filters.minExperience && filters.maxExperience) items.push(`${filters.minExperience}-${filters.maxExperience}年`)
      else if (filters.minExperience) items.push(`≥${filters.minExperience}年`)
      else items.push(`≤${filters.maxExperience}年`)
    }

    if (filters.minAge || filters.maxAge) {
      if (filters.minAge && filters.maxAge) items.push(`${filters.minAge}-${filters.maxAge}岁`)
      else if (filters.minAge) items.push(`≥${filters.minAge}岁`)
      else items.push(`≤${filters.maxAge}岁`)
    }

    if (filters.minMatchScore) items.push(t('resumes.matching.scoreLabel', { score: `≥${filters.minMatchScore}` }))

    if (filters.skills?.length) items.push(filters.skills.join(', '))
    if (filters.locations?.length) items.push(filters.locations.join(', '))

    if (filters.education?.length) {
      items.push(filters.education.map(e => t(EDUCATION_LEVELS.find(l => l.value === e)?.labelKey || '')).join(', '))
    }

    if (filters.status?.length) {
      items.push(filters.status.map(s => t(STATUS_OPTIONS.find(o => o.value === s)?.labelKey || '')).join(', '))
    }

    if (filters.showBlocked) items.push(t('resumes.filters.showBlocked'))

    return items
  }, [filters, t])

  const educationSet = useMemo(() => new Set(education), [education])
  const statusSet = useMemo(() => new Set(status), [status])

  const toggleEducation = (value: string) => {
    setEducation((prev) => {
      if (prev.includes(value)) {
        return prev.filter((item) => item !== value)
      }
      return [...prev, value]
    })
  }

  const toggleStatus = (value: CandidateStatus) => {
    setStatus((prev) => {
      if (prev.includes(value)) {
        return prev.filter((item) => item !== value)
      }
      return [...prev, value]
    })
  }

  const handleApply = () => {
    if (clearing) return
    onFiltersChange({
      ...filters,
      minExperience: minExperience ? Number(minExperience) : undefined,
      maxExperience: maxExperience ? Number(maxExperience) : undefined,
      minAge: minAge ? Number(minAge) : undefined,
      maxAge: maxAge ? Number(maxAge) : undefined,
      minMatchScore: mode === 'ai' && minMatchScore ? Number(minMatchScore) : undefined,
      skills: skills
        ? skills
          .split(/[,，、]/g)
          .map((item) => item.trim())
          .filter(Boolean)
        : undefined,
      locations: locations
        ? locations
          .split(/[,，、]/g)
          .map((item) => item.trim())
          .filter(Boolean)
        : undefined,
      education: education.length ? education : undefined,
      status: status.length ? status : undefined,
      showBlocked,
    })
  }

  const handleClear = () => {
    setClearing(true)
    setMinExperience('')
    setMaxExperience('')
    setMinAge('')
    setMaxAge('')
    setMinMatchScore('')
    setSkills('')
    setLocations('')
    setEducation([])
    setStatus([])
    setShowBlocked(false)
    onFiltersChange({})
    window.setTimeout(() => setClearing(false), 200)
  }

  const toolbarButtonClassName = 'h-10 px-3 text-sm'

  return (
    <div className={cn("rounded-lg border bg-card shadow-sm transition-all duration-200", className)}>
      <div className="px-3 py-3 sm:px-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <button
            type="button"
            aria-expanded={!isCollapsed}
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex min-h-10 min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap rounded-lg text-left"
          >
            <h3 className="shrink-0 text-sm font-semibold text-foreground/90">{t('resumes.filters.title')}</h3>
            {isCollapsed ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />}
            {activeFilterBadges.length > 0 && (
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-hidden text-xs text-muted-foreground">
                {activeFilterBadges.map((badge, i) => (
                  <Badge key={i} variant="secondary" className="font-normal text-[10px] sm:text-xs px-1.5 sm:px-2 py-0 border-transparent bg-muted/60 text-muted-foreground whitespace-nowrap">
                    {badge}
                  </Badge>
                ))}
              </span>
            )}
          </button>

          <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2 lg:w-auto">
            {headerAction}
            {headerAction && <div className="hidden h-5 w-px bg-border lg:block" aria-hidden="true" />}
            <Button
              size="sm"
              variant="ghost"
              onClick={handleClear}
              disabled={clearing}
              className={cn(toolbarButtonClassName, 'text-muted-foreground hover:text-foreground')}
            >
              {t('resumes.filters.clear')}
            </Button>
            <Button size="sm" onClick={handleApply} disabled={clearing} className={toolbarButtonClassName}>
              {t('resumes.filters.apply')}
            </Button>
          </div>
        </div>
      </div>

      {!isCollapsed && (
        <div className="border-t px-3 pb-4 pt-4 sm:px-4">
          <div className="grid gap-6 pt-2">

            {/* Row 1: Numeric Filters */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">{t('resumes.filters.minExperience')}</label>
                  <Input
                    type="number"
                    value={minExperience}
                    onChange={(event) => setMinExperience(event.target.value)}
                    className="bg-background"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">{t('resumes.filters.maxExperience')}</label>
                  <Input
                    type="number"
                    value={maxExperience}
                    onChange={(event) => setMaxExperience(event.target.value)}
                    className="bg-background"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">{t('resumes.filters.minAge')}</label>
                  <Input
                    type="number"
                    value={minAge}
                    onChange={(event) => setMinAge(event.target.value)}
                    className="bg-background"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">{t('resumes.filters.maxAge')}</label>
                  <Input
                    type="number"
                    value={maxAge}
                    onChange={(event) => setMaxAge(event.target.value)}
                    className="bg-background"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t('resumes.filters.minMatchScore')}</label>
                <Input
                  type="number"
                  value={minMatchScore}
                  onChange={(event) => setMinMatchScore(event.target.value)}
                  placeholder="70"
                  className="bg-background"
                  disabled={mode !== 'ai'}
                />
              </div>
            </div>

            {/* Row 2: Text Filters */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t('resumes.filters.skills')}</label>
                <Input
                  value={skills}
                  onChange={(event) => setSkills(event.target.value)}
                  placeholder={t('resumes.filters.skillsPlaceholder')}
                  className="bg-background"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t('resumes.filters.locations')}</label>
                <Input
                  value={locations}
                  onChange={(event) => setLocations(event.target.value)}
                  placeholder={t('resumes.filters.locationsPlaceholder')}
                  className="bg-background"
                />
              </div>
            </div>

            {/* Row 3: Education */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">{t('resumes.filters.education.title')}</label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
                {EDUCATION_LEVELS.map((level) => (
                  <label key={level.value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border/70 bg-background px-3 py-2.5 text-sm text-foreground/80 hover:text-foreground">
                    <Checkbox
                      checked={educationSet.has(level.value)}
                      onCheckedChange={() => toggleEducation(level.value)}
                    />
                    {t(level.labelKey)}
                  </label>
                ))}
              </div>
            </div>

            {/* Row 4: Status and Block Toggle */}
            <div className="space-y-3">
              <label className="text-xs font-medium text-muted-foreground">{t('resumes.filters.status')}</label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {STATUS_OPTIONS.map((item) => (
                  <label key={item.value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border/70 bg-background px-3 py-2.5 text-sm text-foreground/80 hover:text-foreground">
                    <Checkbox
                      checked={statusSet.has(item.value)}
                      onCheckedChange={() => toggleStatus(item.value)}
                    />
                    {t(item.labelKey)}
                  </label>
                ))}
              </div>

              <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border/70 bg-background px-3 py-2.5 text-sm text-foreground/80 hover:text-foreground">
                <Checkbox
                  checked={showBlocked}
                  onCheckedChange={(checked: boolean | 'indeterminate') => setShowBlocked(checked === true)}
                />
                {t('resumes.filters.showBlocked')}
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
