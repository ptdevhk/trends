import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useQuery } from 'convex/react'
import { JobDescriptionSelect } from './JobDescriptionSelect'
import { JobDescriptionEditor } from './JobDescriptionEditor'
import { KeywordChips } from './KeywordChips'
import { rawApiClient } from '@/lib/api-helpers'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { ResumeFilters } from '@/types/resume'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { api } from '../../../../packages/convex/convex/_generated/api'

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
      min_years?: number
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
  onResetAll?: () => void
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

export function QuickStartPanel({
  onApplyConfig,
  defaultLocation = '广东',
  defaultKeywords = [],
  jobDescriptionId = '',
  onJobChange,
  quickFilters,
  onApplyQuickFilters,
  extraActions,
  onResetAll,
}: QuickStartPanelProps) {
  const { t } = useTranslation()
  const { slug } = useWorkspace()

  const [location, setLocation] = useState(defaultLocation)
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>(defaultKeywords)
  const [customKeyword, setCustomKeyword] = useState(defaultKeywords.join(' '))
  const [quickMinRoleYears, setQuickMinRoleYears] = useState(quickFilters?.minRoleYears?.toString() ?? '')
  const [quickMaxAge, setQuickMaxAge] = useState(quickFilters?.maxAge?.toString() ?? '')
  const [activeRoleType, setActiveRoleType] = useState<string | undefined>(quickFilters?.roleFilterType)
  const [jdMinRoleYears, setJdMinRoleYears] = useState<number | undefined>(undefined)
  const [jdMaxAge, setJdMaxAge] = useState<number | undefined>(undefined)
  const [autoMatchResult, setAutoMatchResult] = useState<AutoMatchedProfile | null>(null)
  const [matching, setMatching] = useState(false)
  const [showJdEditor, setShowJdEditor] = useState(false)
  const lastJobDescriptionIdRef = useRef(jobDescriptionId.trim())

  const convexJobDescriptions = useQuery(api.job_descriptions.list, { workspaceSlug: slug })
  const selectedConvexJobDescription = useMemo(() => {
    const normalizedJobDescriptionId = jobDescriptionId.trim()
    if (!normalizedJobDescriptionId || !convexJobDescriptions) {
      return undefined
    }
    return convexJobDescriptions.find((item) => String(item._id) === normalizedJobDescriptionId)
  }, [convexJobDescriptions, jobDescriptionId])
  const selectedConvexJobDescriptionDetail = useQuery(
    api.job_descriptions.get,
    selectedConvexJobDescription ? { id: selectedConvexJobDescription._id } : 'skip'
  )

  const effectiveDefaultMinRoleYears = jdMinRoleYears ?? 1

  useEffect(() => {
    setLocation(defaultLocation)
  }, [defaultLocation])

  useEffect(() => {
    setSelectedKeywords(defaultKeywords)
    setCustomKeyword(defaultKeywords.join(' '))
  }, [defaultKeywords])

  useEffect(() => {
    const normalizedJobDescriptionId = jobDescriptionId.trim()
    const hasJobSelectionChanged = lastJobDescriptionIdRef.current !== normalizedJobDescriptionId

    if (hasJobSelectionChanged) {
      lastJobDescriptionIdRef.current = normalizedJobDescriptionId
      if (normalizedJobDescriptionId) {
        setQuickMinRoleYears(effectiveDefaultMinRoleYears.toString())
        setQuickMaxAge(typeof jdMaxAge === 'number' ? jdMaxAge.toString() : '')
      } else {
        setQuickMinRoleYears('')
        setQuickMaxAge('')
      }
      return
    }

    if (typeof quickFilters?.minRoleYears === 'number') {
      setQuickMinRoleYears(quickFilters.minRoleYears.toString())
    } else if (normalizedJobDescriptionId) {
      setQuickMinRoleYears(effectiveDefaultMinRoleYears.toString())
    } else {
      setQuickMinRoleYears('')
    }

    if (typeof quickFilters?.maxAge === 'number') {
      setQuickMaxAge(quickFilters.maxAge.toString())
    } else if (normalizedJobDescriptionId && typeof jdMaxAge === 'number') {
      setQuickMaxAge(jdMaxAge.toString())
    } else {
      setQuickMaxAge('')
    }
  }, [jobDescriptionId, quickFilters?.maxAge, quickFilters?.minRoleYears, effectiveDefaultMinRoleYears, jdMaxAge])

  useEffect(() => {
    const normalizedJobDescriptionId = jobDescriptionId.trim()
    if (!normalizedJobDescriptionId) {
      setActiveRoleType(undefined)
      setJdMinRoleYears(undefined)
      setJdMaxAge(undefined)
      return
    }

    if (convexJobDescriptions === undefined) {
      return
    }

    if (selectedConvexJobDescription) {
      if (selectedConvexJobDescriptionDetail === undefined) {
        return
      }

      setActiveRoleType(undefined)
      setJdMinRoleYears(
        typeof selectedConvexJobDescriptionDetail?.minExperience === 'number'
          ? selectedConvexJobDescriptionDetail.minExperience
          : 1
      )
      setJdMaxAge(
        typeof selectedConvexJobDescriptionDetail?.maxAge === 'number'
          ? selectedConvexJobDescriptionDetail.maxAge
          : undefined
      )
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
        const requiredRole = response.data?.item?.requiredRoles?.[0]
        const roleType = requiredRole?.type?.trim()
        setActiveRoleType(roleType && roleType.length > 0 ? roleType : undefined)
        setJdMinRoleYears(requiredRole?.min_years)
        setJdMaxAge(undefined)
      } catch (error) {
        console.error('Failed to fetch role type from job description', error)
        if (!cancelled) {
          setActiveRoleType(undefined)
          setJdMinRoleYears(undefined)
          setJdMaxAge(undefined)
        }
      }
    }

    void fetchRoleType()

    return () => {
      cancelled = true
    }
  }, [jobDescriptionId, convexJobDescriptions, selectedConvexJobDescription, selectedConvexJobDescriptionDetail])

  const normalizedKeywords = useMemo(
    () => selectedKeywords.map((keyword) => keyword.trim()).filter((keyword) => keyword.length > 0),
    [selectedKeywords]
  )
  const selectedConvexJobDescriptionProfile = useMemo(() => {
    if (!selectedConvexJobDescription || !selectedConvexJobDescriptionDetail) {
      return undefined
    }
    return selectedConvexJobDescriptionDetail
  }, [selectedConvexJobDescription, selectedConvexJobDescriptionDetail])
  const jdProfileHasStructuredFields = useMemo(() => {
    if (!selectedConvexJobDescriptionProfile) {
      return false
    }
    if (typeof selectedConvexJobDescriptionProfile.minExperience === 'number') {
      return true
    }
    if (typeof selectedConvexJobDescriptionProfile.minAge === 'number' || typeof selectedConvexJobDescriptionProfile.maxAge === 'number') {
      return true
    }
    if (selectedConvexJobDescriptionProfile.location?.trim()) {
      return true
    }
    return (selectedConvexJobDescriptionProfile.industryTags?.length ?? 0) > 0
  }, [selectedConvexJobDescriptionProfile])
  const jdProfileAgeSummary = useMemo(() => {
    if (!selectedConvexJobDescriptionProfile) {
      return undefined
    }
    const minAge = selectedConvexJobDescriptionProfile.minAge
    const maxAge = selectedConvexJobDescriptionProfile.maxAge
    const ageUnit = t('quickStart.ageUnit', '岁')

    if (typeof minAge === 'number' && typeof maxAge === 'number') {
      return `${minAge}-${maxAge}${ageUnit}`
    }
    if (typeof maxAge === 'number') {
      return `≤${maxAge}${ageUnit}`
    }
    if (typeof minAge === 'number') {
      return `≥${minAge}${ageUnit}`
    }
    return undefined
  }, [selectedConvexJobDescriptionProfile, t])
  const editorInitialData = useMemo<ComponentProps<typeof JobDescriptionEditor>['initialData']>(() => {
    if (!selectedConvexJobDescriptionProfile) {
      return undefined
    }
    const commonFields = {
      title: selectedConvexJobDescriptionProfile.title,
      content: selectedConvexJobDescriptionProfile.content,
      location: selectedConvexJobDescriptionProfile.location,
      industryTags: selectedConvexJobDescriptionProfile.industryTags,
      minExperience: selectedConvexJobDescriptionProfile.minExperience,
      minAge: selectedConvexJobDescriptionProfile.minAge,
      maxAge: selectedConvexJobDescriptionProfile.maxAge,
    }
    if (selectedConvexJobDescriptionProfile.type === 'custom') {
      return {
        ...commonFields,
        id: selectedConvexJobDescriptionProfile._id,
        type: 'custom',
      }
    }
    if (selectedConvexJobDescriptionProfile.type === 'system') {
      return {
        ...commonFields,
        type: 'system',
      }
    }
    return undefined
  }, [selectedConvexJobDescriptionProfile])

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

  const handleLocationToggle = useCallback((nextLocation: string) => {
    const normalizedLocation = nextLocation.trim()
    if (!normalizedLocation) {
      return
    }

    setLocation((current) => (current.trim() === normalizedLocation ? '' : normalizedLocation))
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

  const handleJdEditorSaveSuccess = useCallback((newId: string, savedFields?: {
    minExperience?: number
    maxAge?: number
  }) => {
    if (selectedConvexJobDescriptionProfile?.type === 'system') {
      onJobChange?.(newId)
    }

    const fallbackMinRoleYears = quickMinRoleYears ? Number(quickMinRoleYears) : undefined
    const fallbackMaxAge = quickMaxAge ? Number(quickMaxAge) : undefined
    const nextMinRoleYears =
      typeof savedFields?.minExperience === 'number' && Number.isFinite(savedFields.minExperience)
        ? savedFields.minExperience
        : (typeof fallbackMinRoleYears === 'number' && Number.isFinite(fallbackMinRoleYears) ? fallbackMinRoleYears : undefined)
    const nextMaxAge =
      typeof savedFields?.maxAge === 'number' && Number.isFinite(savedFields.maxAge)
        ? savedFields.maxAge
        : (typeof fallbackMaxAge === 'number' && Number.isFinite(fallbackMaxAge) ? fallbackMaxAge : undefined)
    const nextRoleFilterType = activeRoleType?.trim()

    setQuickMinRoleYears(typeof nextMinRoleYears === 'number' ? String(nextMinRoleYears) : '')
    setQuickMaxAge(typeof nextMaxAge === 'number' ? String(nextMaxAge) : '')

    onApplyQuickFilters?.({
      minRoleYears: nextMinRoleYears,
      roleFilterType: nextRoleFilterType && nextRoleFilterType.length > 0 ? nextRoleFilterType : undefined,
      maxAge: nextMaxAge,
    })
  }, [activeRoleType, onApplyQuickFilters, onJobChange, quickMaxAge, quickMinRoleYears, selectedConvexJobDescriptionProfile?.type])

  useEffect(() => {
    const timer = setTimeout(() => {
      const minRoleYears = quickMinRoleYears ? Number(quickMinRoleYears) : undefined
      const maxAge = quickMaxAge ? Number(quickMaxAge) : undefined
      const roleFilterType = activeRoleType?.trim()

      const nextMinRoleYears = typeof minRoleYears === 'number' && Number.isFinite(minRoleYears) ? minRoleYears : undefined
      const nextRoleFilterType = roleFilterType && roleFilterType.length > 0 ? roleFilterType : undefined
      const nextMaxAge = typeof maxAge === 'number' && Number.isFinite(maxAge) ? maxAge : undefined

      if (
        nextMinRoleYears === quickFilters?.minRoleYears
        && nextMaxAge === quickFilters?.maxAge
        && (nextRoleFilterType ?? undefined) === (quickFilters?.roleFilterType ?? undefined)
      ) {
        return
      }

      onApplyQuickFilters?.({
        minRoleYears: nextMinRoleYears,
        roleFilterType: nextRoleFilterType,
        maxAge: nextMaxAge,
      })
    }, 300)

    return () => clearTimeout(timer)
  }, [quickMinRoleYears, quickMaxAge, activeRoleType, onApplyQuickFilters, quickFilters?.minRoleYears, quickFilters?.maxAge, quickFilters?.roleFilterType])

  return (
    <div className="rounded-lg bg-background border px-4 py-4 shadow-sm">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4 flex-1">
            <div className="flex items-center gap-2">
              <label
                htmlFor="quickstart-location"
                className="text-sm font-medium whitespace-nowrap text-muted-foreground"
              >
                {t('quickStart.location', '位置')}
              </label>
              <div className="flex items-center gap-1">
                <input
                  id="quickstart-location"
                  type="text"
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder={t('quickStart.location', '位置')}
                  className="h-9 w-40 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
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

            {onResetAll && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 gap-1 px-3 text-sm font-medium text-foreground/80 hover:text-foreground hover:bg-muted"
                onClick={onResetAll}
              >
                <RotateCcw className="h-4 w-4" />
                {t('quickStart.resetKeywords', '重置')}
              </Button>
            )}
          </div>

          <div className="flex-shrink-0">
            {extraActions}
          </div>
        </div>

        <KeywordChips
          value={selectedKeywords}
          onChange={handleKeywordsChange}
          activeLocation={location}
          onLocationToggle={handleLocationToggle}
        />

        {selectedConvexJobDescriptionProfile ? (
          <div className="rounded-md border border-muted/60 bg-muted/20 px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span aria-hidden>📋</span>
                  <span>{t('quickStart.jdProfile.title', 'JD Profile')}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium">{selectedConvexJobDescriptionProfile.title}</span>
                  {selectedConvexJobDescriptionProfile.location ? (
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                      {selectedConvexJobDescriptionProfile.location}
                    </Badge>
                  ) : null}
                  {selectedConvexJobDescriptionProfile.industryTags?.map((tag) => (
                    <Badge key={`${selectedConvexJobDescriptionProfile._id}-${tag}`} variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">
                      {tag}
                    </Badge>
                  ))}
                  {typeof selectedConvexJobDescriptionProfile.minExperience === 'number' ? (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">
                      {t('quickStart.jdProfile.exp', 'Exp')} {selectedConvexJobDescriptionProfile.minExperience}+{t('quickStart.years', '年')}
                    </Badge>
                  ) : null}
                  {jdProfileAgeSummary ? (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">
                      {t('quickStart.jdProfile.age', 'Age')} {jdProfileAgeSummary}
                    </Badge>
                  ) : null}
                </div>
                {!jdProfileHasStructuredFields ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {t('quickStart.jdProfile.noData', 'No structured fields, click edit to add')}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setShowJdEditor(true)}
                aria-label={t('jdEditor.editTitle', 'Edit Job Description')}
                title={t('jdEditor.editTitle', 'Edit Job Description')}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : null}

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

      </div>
      <JobDescriptionEditor
        open={showJdEditor}
        onOpenChange={setShowJdEditor}
        initialData={editorInitialData}
        onSaveSuccess={handleJdEditorSaveSuccess}
      />
    </div>
  )
}
