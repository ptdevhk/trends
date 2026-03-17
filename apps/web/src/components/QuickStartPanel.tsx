import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { Pencil, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useQuery } from 'convex/react'
import { JobDescriptionSelect } from './JobDescriptionSelect'
import { JobDescriptionEditor } from './JobDescriptionEditor'
import { KeywordChips } from './KeywordChips'
import { SearchProfileEditorDialog, type SearchProfileDetails, type SearchProfileFilters } from './SearchProfileEditorDialog'
import { rawApiClient } from '@/lib/api-helpers'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import type { ResumeFilters } from '@/types/resume'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { buildSeekCollectUrl, getSearchProfileCollectUrl } from '@/lib/search-profile-sources'
import { api } from '../../../../packages/convex/convex/_generated/api'

const AUTO_MATCH_MIN_CONFIDENCE = 0.3
const MALAYSIA_SEEK_WORKFLOW_LOCATION = 'Kuala Lumpur MY'
const MALAYSIA_SEEK_WORKFLOW_KEYWORDS = ['Sales Engineer', 'Sales Manager']

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
    location?: string
    autoMatch?: {
      keywords?: string[]
    }
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

type QuickStartWorkflow = {
  id: string
  label: string
  location: string
  keywords: string[]
  collectUrl?: string
}

interface QuickStartPanelProps {
  onApplyConfig?: (
    config: {
      location: string
      keywords: string[]
      jobDescriptionId?: string
      collectUrl?: string
      filters?: Partial<ResumeFilters>
    },
    applyDuringUrlHydration?: boolean
  ) => void
  defaultLocation?: string
  defaultKeywords?: string[]
  defaultCollectUrl?: string
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
  if (typeof filters.minAge === 'number') {
    mapped.minAge = filters.minAge
  }
  if (typeof filters.maxAge === 'number') {
    mapped.maxAge = filters.maxAge
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

function formatExperienceSummary(filters: SearchProfileFilters | undefined, yearsLabel: string): string | undefined {
  if (!filters) {
    return undefined
  }

  const suffix = yearsLabel
    ? `${yearsLabel.length > 1 ? ' ' : ''}${yearsLabel}`
    : ''
  if (typeof filters.minExperience === 'number' && typeof filters.maxExperience === 'number') {
    return `${filters.minExperience}-${filters.maxExperience}${suffix}`
  }
  if (typeof filters.minExperience === 'number') {
    return `${filters.minExperience}+${suffix}`
  }
  if (typeof filters.maxExperience === 'number') {
    return `<=${filters.maxExperience}${suffix}`
  }
  return undefined
}

function formatAgeSummary(filters: SearchProfileFilters | undefined, ageUnit: string): string | undefined {
  if (!filters) {
    return undefined
  }

  if (typeof filters.minAge === 'number' && typeof filters.maxAge === 'number') {
    return ageUnit
      ? `${filters.minAge}-${filters.maxAge}${ageUnit}`
      : `Age ${filters.minAge}-${filters.maxAge}`
  }
  if (typeof filters.minAge === 'number') {
    return ageUnit
      ? `≥${filters.minAge}${ageUnit}`
      : `Age >=${filters.minAge}`
  }
  if (typeof filters.maxAge === 'number') {
    return ageUnit
      ? `≤${filters.maxAge}${ageUnit}`
      : `Age <=${filters.maxAge}`
  }
  return undefined
}

function getFilterSummary(profile: SearchProfileDetails, yearsLabel: string, ageUnit: string): string {
  const summaryParts: string[] = []
  const filters = profile.filters

  const experienceSummary = formatExperienceSummary(filters, yearsLabel)
  if (experienceSummary) {
    summaryParts.push(experienceSummary)
  }

  const ageSummary = formatAgeSummary(filters, ageUnit)
  if (ageSummary) {
    summaryParts.push(ageSummary)
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

function parseLocationParts(value: string): string[] {
  const seen = new Set<string>()
  const parts: string[] = []

  value
    .split(/[,，、]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      if (seen.has(item)) {
        return
      }
      seen.add(item)
      parts.push(item)
    })

  return parts
}

const QUICK_START_WORKFLOWS: QuickStartWorkflow[] = [
  {
    id: 'seek-malaysia-sales',
    label: 'SEEK · Sales Engineer / Sales Manager · Kuala Lumpur MY',
    location: MALAYSIA_SEEK_WORKFLOW_LOCATION,
    keywords: MALAYSIA_SEEK_WORKFLOW_KEYWORDS,
    collectUrl: buildSeekCollectUrl({
      location: MALAYSIA_SEEK_WORKFLOW_LOCATION,
      keywords: MALAYSIA_SEEK_WORKFLOW_KEYWORDS,
    }) ?? undefined,
  },
]

function normalizeProfileKeywords(profile: SearchProfileDetails): string[] {
  return profile.keywords.map((keyword) => keyword.trim()).filter((keyword) => keyword.length > 0)
}

function getProfileQuickConstraints(profile: SearchProfileDetails): {
  minRoleYears?: number
  maxAge?: number
} {
  return {
    minRoleYears: typeof profile.filters?.minExperience === 'number' ? profile.filters.minExperience : undefined,
    maxAge: typeof profile.filters?.maxAge === 'number' ? profile.filters.maxAge : undefined,
  }
}

async function fetchAutoMatchedProfile(
  inputLocation: string,
  inputKeywords: string[],
): Promise<AutoMatchedProfile | null> {
  const trimmedLocation = inputLocation.trim()
  if (inputKeywords.length === 0) {
    return null
  }

  const autoMatch = await rawApiClient.POST<AutoMatchApiResponse>('/api/search-profiles/auto-match', {
    body: {
      keywords: inputKeywords,
      ...(trimmedLocation ? { location: trimmedLocation } : {}),
    },
  })

  if (!autoMatch.data?.success || !autoMatch.data.profileId || autoMatch.data.confidence <= AUTO_MATCH_MIN_CONFIDENCE) {
    return null
  }

  const profileDetail = await rawApiClient.GET<ProfileApiResponse>(`/api/search-profiles/${autoMatch.data.profileId}`)
  if (!profileDetail.data?.success || !profileDetail.data.profile) {
    return null
  }

  return {
    confidence: autoMatch.data.confidence,
    matchedKeywords: autoMatch.data.matchedKeywords,
    profile: profileDetail.data.profile,
  }
}

export function QuickStartPanel({
  onApplyConfig,
  defaultLocation = '广东',
  defaultKeywords = [],
  defaultCollectUrl,
  jobDescriptionId = '',
  onJobChange,
  quickFilters,
  onApplyQuickFilters,
  extraActions,
  onResetAll,
}: QuickStartPanelProps) {
  const { t } = useTranslation()
  const { slug } = useWorkspace()
  const yearsLabel = t('quickStart.years', 'yrs')
  const ageUnit = t('quickStart.ageUnit', '')

  const [location, setLocation] = useState(defaultLocation)
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>(defaultKeywords)
  const [customKeyword, setCustomKeyword] = useState(defaultKeywords.join(' '))
  const [collectUrl, setCollectUrl] = useState(defaultCollectUrl)
  const [quickMinRoleYears, setQuickMinRoleYears] = useState(quickFilters?.minRoleYears?.toString() ?? '')
  const [quickMaxAge, setQuickMaxAge] = useState(quickFilters?.maxAge?.toString() ?? '')
  const [activeRoleType, setActiveRoleType] = useState<string | undefined>(quickFilters?.roleFilterType)
  const [jdMinRoleYears, setJdMinRoleYears] = useState<number | undefined>(undefined)
  const [jdMaxAge, setJdMaxAge] = useState<number | undefined>(undefined)
  const [autoMatchResult, setAutoMatchResult] = useState<AutoMatchedProfile | null>(null)
  const [matching, setMatching] = useState(false)
  const [showJdEditor, setShowJdEditor] = useState(false)
  const [showProfileEditor, setShowProfileEditor] = useState(false)
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
    setCollectUrl(defaultCollectUrl)
  }, [defaultCollectUrl])

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

      if (selectedConvexJobDescriptionDetail?.location) {
        setLocation(selectedConvexJobDescriptionDetail.location)
      }

      if (selectedConvexJobDescriptionDetail?.customKeywords && selectedConvexJobDescriptionDetail.customKeywords.length > 0) {
        setSelectedKeywords(selectedConvexJobDescriptionDetail.customKeywords.map(k => k.trim()))
        setCustomKeyword(selectedConvexJobDescriptionDetail.customKeywords.join(' '))
      }

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

        if (!selectedConvexJobDescriptionDetail && response.data?.item) {
          const itemLocation = response.data.item.location
          const autoMatchKeywords = response.data.item.autoMatch?.keywords

          if (itemLocation) {
            setLocation(itemLocation)
          }

          if (autoMatchKeywords && autoMatchKeywords.length > 0) {
            setSelectedKeywords(autoMatchKeywords.map(k => k.trim()))
            setCustomKeyword(autoMatchKeywords.join(' '))
          } else {
            setSelectedKeywords([])
            setCustomKeyword('')
          }
        }
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
      customKeywords: selectedConvexJobDescriptionProfile.customKeywords,
      minExperience: selectedConvexJobDescriptionProfile.minExperience,
      maxExperience: selectedConvexJobDescriptionProfile.maxExperience,
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
        collectUrl,
      })
    }, 500)

    return () => clearTimeout(timer)
  }, [collectUrl, location, normalizedKeywords, jobDescriptionId, onApplyConfig])

  useEffect(() => {
    if (normalizedKeywords.length === 0) {
      setAutoMatchResult(null)
      setMatching(false)
      return
    }

    let cancelled = false
    const timer = setTimeout(async () => {
      setMatching(true)

      try {
        const nextAutoMatchResult = await fetchAutoMatchedProfile(location, normalizedKeywords)
        if (!cancelled) {
          setAutoMatchResult(nextAutoMatchResult)
        }
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
    setCollectUrl(undefined)
  }, [])

  const handleLocationToggle = useCallback(
    (toggleLocation: string) => {
      const parts = parseLocationParts(location)
      const nextParts = new Set(parts)

      if (nextParts.has(toggleLocation)) {
        nextParts.delete(toggleLocation)
      } else {
        if (nextParts.size >= 10) {
          toast.warning(t('quickStart.maxLocations', '最多选择10个位置'))
          return
        }
        nextParts.add(toggleLocation)
      }

      setCollectUrl(undefined)
      setLocation(Array.from(nextParts).join(','))
    },
    [location, setLocation, t]
  )

  const handleJobChange = useCallback((value: string) => {
    setCollectUrl(undefined)
    onJobChange?.(value)
  }, [onJobChange])

  const handleApplyWorkflow = useCallback((workflow: QuickStartWorkflow) => {
    setLocation(workflow.location)
    setSelectedKeywords(workflow.keywords)
    setCustomKeyword(workflow.keywords.join(' '))
    setCollectUrl(workflow.collectUrl)
    onJobChange?.('')
  }, [onJobChange])

  const applyProfileToLiveSearch = useCallback((profile: SearchProfileDetails) => {
    const profileLocation = profile.location.trim()
    const profileKeywords = normalizeProfileKeywords(profile)
    const nextJobDescriptionId = profile.jobDescription?.trim() || ''
    const nextCollectUrl = getSearchProfileCollectUrl(profile.sources)
    const quickConstraints = getProfileQuickConstraints(profile)

    setLocation(profileLocation)
    setSelectedKeywords(profileKeywords)
    setCustomKeyword(profileKeywords.join(' '))
    setCollectUrl(nextCollectUrl)
    setQuickMinRoleYears(
      typeof quickConstraints.minRoleYears === 'number' ? String(quickConstraints.minRoleYears) : ''
    )
    setQuickMaxAge(typeof quickConstraints.maxAge === 'number' ? String(quickConstraints.maxAge) : '')

    onJobChange?.(nextJobDescriptionId)
    onApplyConfig?.({
      location: profileLocation,
      keywords: profileKeywords,
      jobDescriptionId: nextJobDescriptionId || undefined,
      collectUrl: nextCollectUrl,
      filters: mapProfileFiltersToResumeFilters(profile.filters),
    }, true)
    onApplyQuickFilters?.({
      minRoleYears: quickConstraints.minRoleYears,
      roleFilterType: undefined,
      maxAge: quickConstraints.maxAge,
    })
  }, [onApplyConfig, onApplyQuickFilters, onJobChange])

  const handleUseMatchedConfig = useCallback(() => {
    if (!autoMatchResult) {
      return
    }

    applyProfileToLiveSearch(autoMatchResult.profile)
  }, [applyProfileToLiveSearch, autoMatchResult])

  const handleJdEditorSaveSuccess = useCallback((newId: string, savedFields?: {
    location?: string
    title?: string
    customKeywords?: string[]
    minExperience?: number
    maxAge?: number
  }) => {
    setCollectUrl(undefined)
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

    if (savedFields) {
      if (savedFields.location) {
        setLocation(savedFields.location)
      }

      if (savedFields.customKeywords && savedFields.customKeywords.length > 0) {
        setSelectedKeywords(savedFields.customKeywords.map(k => k.trim()))
        setCustomKeyword(savedFields.customKeywords.join(' '))
      } else if (savedFields.title) {
        const titleWords = savedFields.title.split(/[\s-]+/).filter(Boolean)
        if (titleWords.length > 0) {
          setSelectedKeywords(titleWords)
          setCustomKeyword(titleWords.join(' '))
        }
      }
    }

    setQuickMinRoleYears(typeof nextMinRoleYears === 'number' ? String(nextMinRoleYears) : '')
    setQuickMaxAge(typeof nextMaxAge === 'number' ? String(nextMaxAge) : '')

    onApplyQuickFilters?.({
      minRoleYears: nextMinRoleYears,
      roleFilterType: nextRoleFilterType && nextRoleFilterType.length > 0 ? nextRoleFilterType : undefined,
      maxAge: nextMaxAge,
    })
  }, [activeRoleType, onApplyQuickFilters, onJobChange, quickMaxAge, quickMinRoleYears, selectedConvexJobDescriptionProfile?.type])

  const handleProfileEditorSaved = useCallback((profile?: SearchProfileDetails) => {
    if (!profile) {
      return
    }

    applyProfileToLiveSearch(profile)
    setAutoMatchResult((previous) => (
      previous && previous.profile.id === profile.id
        ? {
            ...previous,
            profile,
          }
        : previous
    ))
  }, [applyProfileToLiveSearch])

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
                  onChange={(event) => {
                    setCollectUrl(undefined)
                    setLocation(event.target.value)
                  }}
                  placeholder={t('quickStart.locationTooltip', '位置 (逗号分隔)')}
                  title={t('quickStart.locationTooltip', '支持多个位置，用逗号分隔，最多10个')}
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
                    setCollectUrl(undefined)
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
          activeLocations={parseLocationParts(location)}
          onLocationToggle={handleLocationToggle}
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">
            {t('quickStart.workflows', 'Workflow')}:
          </span>
          {QUICK_START_WORKFLOWS.map((workflow) => (
            <Button
              key={workflow.id}
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-full px-3 text-xs"
              onClick={() => handleApplyWorkflow(workflow)}
            >
              {workflow.label}
            </Button>
          ))}
        </div>

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
                {t('quickStart.autoMatchFilters', 'Filters')}: {getFilterSummary(autoMatchResult.profile, yearsLabel, ageUnit)}
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
              <Button
                variant="link"
                className="h-auto p-0 text-xs text-primary underline-offset-4 hover:underline"
                onClick={() => setShowProfileEditor(true)}
              >
                {t('quickStart.modifyConfig', 'Modify')}
              </Button>
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

      {autoMatchResult?.profile.id && (
        <SearchProfileEditorDialog
          open={showProfileEditor}
          onOpenChange={setShowProfileEditor}
          profileId={autoMatchResult.profile.id}
          initialData={autoMatchResult.profile}
          onSaved={handleProfileEditorSaved}
        />
      )}
    </div>
  )
}
