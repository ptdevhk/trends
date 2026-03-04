import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { JobDescriptionSelect } from './JobDescriptionSelect'
import { KeywordChips } from './KeywordChips'
import { rawApiClient } from '@/lib/api-helpers'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { ResumeFilters } from '@/types/resume'
import { useWorkspace } from '@/contexts/WorkspaceContext'

const COMMON_LOCATIONS = [
  '广东', '东莞', '深圳', '广州', '佛山', '惠州', '苏州', '无锡', '常州', '昆山', '上海',
]

const AUTO_MATCH_MIN_CONFIDENCE = 0.3

type SearchProfileFilters = {
  minExperience?: number
  maxExperience?: number | null
  education?: string[]
  salaryRange?: {
    min?: number
    max?: number
  }
  locations?: string[]
}

type SearchProfileDetails = {
  id: string
  name: string
  location: string
  keywords: string[]
  jobDescription?: string
  filterPreset?: string
  filters?: SearchProfileFilters
}

type AutoMatchApiResponse = {
  success: boolean
  profileId?: string
  confidence: number
  matchedKeywords: string[]
}

type ProfileApiResponse = {
  success: boolean
  profile?: SearchProfileDetails
}

type JobDescriptionDetailApiResponse = {
  success: boolean
  item?: {
    requiredRoles?: Array<{
      type?: string
    }>
  }
}

type AutoMatchedProfile = {
  confidence: number
  matchedKeywords: string[]
  profile: SearchProfileDetails
}

interface QuickStartPanelProps {
  onApplyConfig?: (config: {
    location: string
    keywords: string[]
    jobDescriptionId?: string
    filters?: Partial<ResumeFilters>
  }) => void
  defaultLocation?: string
  defaultKeywords?: string[]
  jobDescriptionId?: string
  onJobChange?: (value: string) => void
  quickFilters?: {
    minRoleYears?: number
    roleFilterType?: string
    maxAge?: number
  }
  onApplyQuickFilters?: (filters: {
    minRoleYears?: number
    roleFilterType?: string
    maxAge?: number
  }) => void
  extraActions?: React.ReactNode
}

function mapProfileFiltersToResumeFilters(filters: SearchProfileFilters | undefined): Partial<ResumeFilters> | undefined {
  if (!filters) {
    return undefined
  }

  const mapped: Partial<ResumeFilters> = {}
  if (typeof filters.minExperience === 'number') {
    mapped.minExperience = filters.minExperience
  }
  if (typeof filters.maxExperience === 'number') {
    mapped.maxExperience = filters.maxExperience
  }
  if (Array.isArray(filters.education) && filters.education.length > 0) {
    mapped.education = filters.education
  }
  if (typeof filters.salaryRange?.min === 'number') {
    mapped.minSalary = filters.salaryRange.min
  }
  if (typeof filters.salaryRange?.max === 'number') {
    mapped.maxSalary = filters.salaryRange.max
  }
  if (Array.isArray(filters.locations) && filters.locations.length > 0) {
    mapped.locations = filters.locations
  }

  return Object.keys(mapped).length > 0 ? mapped : undefined
}

function getFilterSummary(profile: SearchProfileDetails): string {
  const summaryParts: string[] = []
  const filters = profile.filters

  if (typeof filters?.minExperience === 'number') {
    summaryParts.push(`${filters.minExperience}+ yrs`)
  }

  if (Array.isArray(filters?.education) && filters.education.length > 0) {
    summaryParts.push(filters.education.join('/'))
  }

  if (typeof filters?.salaryRange?.min === 'number' || typeof filters?.salaryRange?.max === 'number') {
    const min = filters.salaryRange?.min ?? 0
    const max = filters.salaryRange?.max ?? 0
    if (min > 0 && max > 0) {
      summaryParts.push(`${min}-${max}`)
    } else if (min > 0) {
      summaryParts.push(`${min}+`)
    } else if (max > 0) {
      summaryParts.push(`<=${max}`)
    }
  }

  if (summaryParts.length > 0) {
    return summaryParts.join(' | ')
  }

  if (profile.filterPreset) {
    return profile.filterPreset
  }

  return 'default'
}

const ROLE_LABELS: Record<string, string> = {
  sales: '销售经验',
  engineer: '工程经验',
}

function getRoleLabel(roleType: string | undefined): string {
  if (!roleType) {
    return '相关经验'
  }
  const normalized = roleType.trim().toLowerCase()
  if (!normalized) {
    return '相关经验'
  }
  return ROLE_LABELS[normalized] ?? '相关经验'
}

export function QuickStartPanel({
  onApplyConfig,
  defaultLocation = '广东',
  defaultKeywords = [],
  jobDescriptionId = '',
  onJobChange,
  quickFilters,
  onApplyQuickFilters,
  extraActions,
}: QuickStartPanelProps) {
  const { t } = useTranslation()
  const { slug } = useWorkspace()

  const [location, setLocation] = useState(defaultLocation)
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>(defaultKeywords)
  const [customKeyword, setCustomKeyword] = useState(defaultKeywords.join(' '))
  const [quickMinRoleYears, setQuickMinRoleYears] = useState(quickFilters?.minRoleYears?.toString() ?? '')
  const [quickMaxAge, setQuickMaxAge] = useState(quickFilters?.maxAge?.toString() ?? '')
  const [activeRoleType, setActiveRoleType] = useState<string | undefined>(quickFilters?.roleFilterType)
  const [autoMatchResult, setAutoMatchResult] = useState<AutoMatchedProfile | null>(null)
  const [matching, setMatching] = useState(false)

  useEffect(() => {
    setLocation(defaultLocation)
  }, [defaultLocation])

  useEffect(() => {
    setSelectedKeywords(defaultKeywords)
    setCustomKeyword(defaultKeywords.join(' '))
  }, [defaultKeywords])

  useEffect(() => {
    setQuickMinRoleYears(quickFilters?.minRoleYears?.toString() ?? '')
    setQuickMaxAge(quickFilters?.maxAge?.toString() ?? '')
  }, [quickFilters?.maxAge, quickFilters?.minRoleYears])

  useEffect(() => {
    const normalizedJobDescriptionId = jobDescriptionId.trim()
    if (!normalizedJobDescriptionId) {
      setActiveRoleType(undefined)
      return
    }

    let cancelled = false

    const fetchRoleType = async () => {
      try {
        const response = await rawApiClient.GET<JobDescriptionDetailApiResponse>(
          `/api/job-descriptions/${encodeURIComponent(normalizedJobDescriptionId)}`
        )
        if (cancelled) {
          return
        }
        const roleType = response.data?.item?.requiredRoles?.[0]?.type?.trim()
        setActiveRoleType(roleType && roleType.length > 0 ? roleType : undefined)
      } catch (error) {
        console.error('Failed to fetch role type from job description', error)
        if (!cancelled) {
          setActiveRoleType(undefined)
        }
      }
    }

    void fetchRoleType()

    return () => {
      cancelled = true
    }
  }, [jobDescriptionId])

  const normalizedKeywords = useMemo(
    () => selectedKeywords.map((keyword) => keyword.trim()).filter((keyword) => keyword.length > 0),
    [selectedKeywords]
  )

  useEffect(() => {
    const effectiveJobDescriptionId = jobDescriptionId || undefined

    const timer = setTimeout(() => {
      onApplyConfig?.({
        location,
        keywords: normalizedKeywords,
        jobDescriptionId: effectiveJobDescriptionId,
      })
    }, 500)

    return () => clearTimeout(timer)
  }, [location, normalizedKeywords, jobDescriptionId, onApplyConfig])

  useEffect(() => {
    const trimmedLocation = location.trim()
    if (!trimmedLocation || normalizedKeywords.length === 0) {
      setAutoMatchResult(null)
      setMatching(false)
      return
    }

    let cancelled = false
    const timer = setTimeout(async () => {
      setMatching(true)

      try {
        const autoMatch = await rawApiClient.POST<AutoMatchApiResponse>('/api/search-profiles/auto-match', {
          body: {
            keywords: normalizedKeywords,
            location: trimmedLocation,
          },
        })

        if (cancelled || !autoMatch.data?.success || !autoMatch.data.profileId || autoMatch.data.confidence <= AUTO_MATCH_MIN_CONFIDENCE) {
          setAutoMatchResult(null)
          return
        }

        const profileDetail = await rawApiClient.GET<ProfileApiResponse>(`/api/search-profiles/${autoMatch.data.profileId}`)
        if (cancelled || !profileDetail.data?.success || !profileDetail.data.profile) {
          setAutoMatchResult(null)
          return
        }

        setAutoMatchResult({
          confidence: autoMatch.data.confidence,
          matchedKeywords: autoMatch.data.matchedKeywords,
          profile: profileDetail.data.profile,
        })
      } catch (error) {
        console.error('Failed to auto-match search profile', error)
        if (!cancelled) {
          setAutoMatchResult(null)
        }
      } finally {
        if (!cancelled) {
          setMatching(false)
        }
      }
    }, 500)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [location, normalizedKeywords])

  const handleKeywordsChange = useCallback((keywords: string[]) => {
    setSelectedKeywords(keywords)
    setCustomKeyword(keywords.join(' '))
  }, [])

  const handleJobChange = useCallback((value: string) => {
    onJobChange?.(value)
  }, [onJobChange])

  const handleUseMatchedConfig = useCallback(() => {
    if (!autoMatchResult) {
      return
    }

    const profile = autoMatchResult.profile
    const profileKeywords = profile.keywords.length > 0 ? profile.keywords : normalizedKeywords

    setLocation(profile.location || location)
    setSelectedKeywords(profileKeywords)
    setCustomKeyword(profileKeywords.join(' '))

    if (profile.jobDescription) {
      onJobChange?.(profile.jobDescription)
    }

    onApplyConfig?.({
      location: profile.location || location,
      keywords: profileKeywords,
      jobDescriptionId: profile.jobDescription,
      filters: mapProfileFiltersToResumeFilters(profile.filters),
    })
  }, [autoMatchResult, location, normalizedKeywords, onApplyConfig, onJobChange])

  const handleResetKeywords = useCallback(() => {
    setSelectedKeywords([])
    setCustomKeyword('')
    onJobChange?.('')
  }, [onJobChange])

  const handleApplyQuickFilters = useCallback(() => {
    const minRoleYears = quickMinRoleYears ? Number(quickMinRoleYears) : undefined
    const maxAge = quickMaxAge ? Number(quickMaxAge) : undefined
    const roleFilterType = activeRoleType?.trim()
    onApplyQuickFilters?.({
      minRoleYears: typeof minRoleYears === 'number' && Number.isFinite(minRoleYears) ? minRoleYears : undefined,
      roleFilterType: roleFilterType && roleFilterType.length > 0 ? roleFilterType : undefined,
      maxAge: typeof maxAge === 'number' && Number.isFinite(maxAge) ? maxAge : undefined,
    })
  }, [activeRoleType, onApplyQuickFilters, quickMaxAge, quickMinRoleYears])

  return (
    <div className="rounded-lg bg-background border px-4 py-4 shadow-sm">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4 flex-1">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium whitespace-nowrap">
                {t('quickStart.location', '位置')}
              </label>
              <div className="relative w-32 sm:w-40">
                <input
                  type="text"
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder="广东"
                  list="location-suggestions"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <datalist id="location-suggestions">
                  {COMMON_LOCATIONS.map((loc) => (
                    <option key={loc} value={loc} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm font-medium whitespace-nowrap text-muted-foreground">
                {t('quickStart.customKeywords', '关键词')}
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={customKeyword}
                  onChange={(event) => {
                    const value = event.target.value
                    setCustomKeyword(value)
                    const parts = value.split(/[\s,]+/).filter(Boolean)
                    setSelectedKeywords(parts)
                  }}
                  placeholder={t('quickStart.customKeywordPlaceholder', '关键词 (空格分隔)...')}
                  className="h-9 w-full sm:w-64 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm font-medium whitespace-nowrap text-muted-foreground">
                {t('quickStart.manualJd', '手动职位(可选)')}
              </label>
              <div className="w-48">
                <JobDescriptionSelect
                  value={jobDescriptionId}
                  onChange={handleJobChange}
                  disabled={!onJobChange}
                />
              </div>
            </div>
          </div>

          <div className="flex-shrink-0">
            {extraActions}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">
              {t('quickStart.hotKeywords', '热门关键词')}
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={handleResetKeywords}
            >
              <RotateCcw className="h-3 w-3" />
              {t('quickStart.resetKeywords', '重置')}
            </Button>
          </div>
          <KeywordChips value={selectedKeywords} onChange={handleKeywordsChange} />
        </div>

        {matching ? (
          <div className="rounded-md border border-dashed border-muted-foreground/40 px-3 py-2 text-xs text-muted-foreground">
            {t('quickStart.autoMatchLoading', 'Matching profile...')}
          </div>
        ) : null}

        {autoMatchResult ? (
          <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">
                {t('quickStart.autoMatchTitle', '智能匹配')}:
              </span>
              <Badge variant="outline" className="border-primary/30 text-primary">
                {autoMatchResult.profile.name}
              </Badge>
              <span className="text-muted-foreground">
                {Math.round(autoMatchResult.confidence * 100)}%
              </span>
            </div>
            <div className="mt-2 text-xs text-muted-foreground space-y-1">
              <div>
                {t('quickStart.autoMatchJd', 'JD')}: {autoMatchResult.profile.jobDescription || '--'}
              </div>
              <div>
                {t('quickStart.autoMatchFilters', 'Filters')}: {getFilterSummary(autoMatchResult.profile)}
              </div>
              {autoMatchResult.matchedKeywords.length > 0 ? (
                <div>
                  {t('quickStart.autoMatchKeywords', 'Matched')}: {autoMatchResult.matchedKeywords.join(', ')}
                </div>
              ) : null}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Button size="sm" onClick={handleUseMatchedConfig}>
                {t('quickStart.useConfig', 'Use this config')}
              </Button>
              <Link
                to={`/${slug}/system/profiles?edit=${encodeURIComponent(autoMatchResult.profile.id)}`}
                className="text-xs text-primary underline-offset-4 hover:underline"
              >
                {t('quickStart.modifyConfig', 'Modify')}
              </Link>
            </div>
          </div>
        ) : null}

        <div className="rounded-md border border-dashed border-muted-foreground/30 px-3 py-3">
          <div className="text-sm font-medium">⚡ 快速筛选</div>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="text-sm text-muted-foreground">
              要求{getRoleLabel(activeRoleType)} 最少
              <input
                type="number"
                min={0}
                value={quickMinRoleYears}
                onChange={(event) => setQuickMinRoleYears(event.target.value)}
                className="mx-2 h-8 w-20 rounded-md border border-input bg-background px-2 text-sm"
              />
              年
            </label>
            <label className="text-sm text-muted-foreground">
              最高年龄
              <input
                type="number"
                min={0}
                value={quickMaxAge}
                onChange={(event) => setQuickMaxAge(event.target.value)}
                className="mx-2 h-8 w-20 rounded-md border border-input bg-background px-2 text-sm"
              />
            </label>
            <Button size="sm" variant="outline" onClick={handleApplyQuickFilters}>
              应用快速筛选
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
