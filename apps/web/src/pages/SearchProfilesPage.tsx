import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { rawApiClient } from '@/lib/api-helpers'
import { isHeadlessCollectorEnabled } from '@/lib/feature-flags'
import { ProfileCard, type SearchProfileRunStatus, type SearchProfileSummary } from '@/components/ProfileCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PageHeader } from '@/components/PageHeader'
import { SearchProfileEditorDialog, type SearchProfileDetails } from '@/components/SearchProfileEditorDialog'
import {
  SEARCH_PROFILE_SOURCE_TYPES,
  buildCollectionLaunchUrl,
  getActiveSearchProfileSource,
  resolveSeekModeFromUrl,
  type CollectionSourceType,
} from '@/lib/search-profile-sources'
import { reportUiError } from '@/lib/ui-error-reporting'

type ListProfilesResponse = {
  success: boolean
  profiles: SearchProfileSummary[]
}

type ProfileResponse = {
  success: boolean
  profile?: SearchProfileDetails
}

type RunProfileSuccessResponse = {
  success: true
  profileId: string
  taskId: string
}

type RunProfileErrorResponse = {
  success: false
  error?: string
}

type RunProfileResponse = RunProfileSuccessResponse | RunProfileErrorResponse

type ProfileStatusResponse = {
  success: boolean
  status?: SearchProfileRunStatus | null
}

const TERMINAL_STATUSES: Array<SearchProfileRunStatus['taskStatus']> = ['completed', 'failed', 'cancelled', 'unknown']
const DEFAULT_PROFILE_RUN_LIMIT = 120
const DEFAULT_PROFILE_RUN_MAX_PAGES = 10



function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function extractApiErrorMessage(error: unknown): string | null {
  const direct = readString(error)
  if (direct) {
    return direct
  }

  if (!isRecord(error)) {
    return null
  }

  const detail = readString(error.detail)
  if (detail) {
    return detail
  }

  const message = readString(error.message)
  if (message) {
    return message
  }

  const nestedError = error.error
  if (isRecord(nestedError)) {
    const nestedMessage = readString(nestedError.message)
    if (nestedMessage) {
      return nestedMessage
    }
    const nestedErrorText = readString(nestedError.error)
    if (nestedErrorText) {
      return nestedErrorText
    }
  }

  return readString(nestedError)
}

function isLikelyNetworkError(message: string | null): boolean {
  if (!message) {
    return false
  }
  const normalized = message.toLowerCase()
  return normalized.includes('failed to fetch')
    || normalized.includes('networkerror')
    || normalized.includes('err_connection_refused')
}

function buildScheduleLabel(profile?: SearchProfileDetails): string {
  if (!profile?.schedule?.enabled) {
    return 'disabled'
  }
  return profile.schedule.cron || 'enabled'
}

export function SearchProfilesPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()

  const [loading, setLoading] = useState(true)
  const [profiles, setProfiles] = useState<SearchProfileSummary[]>([])
  const [profileDetails, setProfileDetails] = useState<Record<string, SearchProfileDetails>>({})
  const [runStatuses, setRunStatuses] = useState<Record<string, SearchProfileRunStatus>>({})
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set())
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null)

  const pollTimersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({})
  const runNowLocksRef = useRef<Set<string>>(new Set())
  const headModeResetTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const clearPolling = useCallback((profileId: string) => {
    const timer = pollTimersRef.current[profileId]
    if (timer) {
      clearInterval(timer)
      delete pollTimersRef.current[profileId]
    }
  }, [])

  const clearHeadModePendingRun = useCallback((profileId: string) => {
    const timer = headModeResetTimersRef.current[profileId]
    if (timer) {
      clearTimeout(timer)
      delete headModeResetTimersRef.current[profileId]
    }
    runNowLocksRef.current.delete(profileId)
    setRunningIds((previous) => {
      if (!previous.has(profileId)) {
        return previous
      }
      const next = new Set(previous)
      next.delete(profileId)
      return next
    })
  }, [])

  const fetchRunStatus = useCallback(async (profileId: string) => {
    try {
      const { data } = await rawApiClient.GET<ProfileStatusResponse>(`/api/search-profiles/${profileId}/status`)
      const status = data?.status
      if (!data?.success || !status) {
        return null
      }

      setRunStatuses((previous) => ({
        ...previous,
        [profileId]: status,
      }))

      if (TERMINAL_STATUSES.includes(status.taskStatus)) {
        clearPolling(profileId)
        setRunningIds((previous) => {
          if (!previous.has(profileId)) {
            return previous
          }
          const next = new Set(previous)
          next.delete(profileId)
          return next
        })
      }

      return status
    } catch (error) {
      reportUiError(`Failed to load run status for profile ${profileId}`, error)
      return null
    }
  }, [clearPolling])

  const startPolling = useCallback((profileId: string) => {
    clearPolling(profileId)

    void fetchRunStatus(profileId)
    pollTimersRef.current[profileId] = setInterval(() => {
      void fetchRunStatus(profileId)
    }, 3000)
  }, [clearPolling, fetchRunStatus])

  const fetchProfileDetail = useCallback(async (profileId: string) => {
    try {
      const { data } = await rawApiClient.GET<ProfileResponse>(`/api/search-profiles/${profileId}`)
      if (!data?.success || !data.profile) {
        return null
      }

      const profile = data.profile

      setProfileDetails((previous) => ({
        ...previous,
        [profileId]: profile,
      }))
      return profile
    } catch (error) {
      reportUiError(`Failed to load profile detail ${profileId}`, error)
      return null
    }
  }, [])

  const loadProfiles = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await rawApiClient.GET<ListProfilesResponse>('/api/search-profiles')
      if (!data?.success) {
        throw new Error('Failed to load profiles')
      }

      const nextProfiles = data.profiles || []
      setProfiles(nextProfiles)

      const detailEntries = await Promise.all(
        nextProfiles.map(async (profile) => {
          const detail = await fetchProfileDetail(profile.id)
          return detail ? [profile.id, detail] as const : null
        }),
      )

      const nextDetails: Record<string, SearchProfileDetails> = {}
      detailEntries.forEach((entry) => {
        if (!entry) {
          return
        }
        nextDetails[entry[0]] = entry[1]
      })
      setProfileDetails(nextDetails)

      await Promise.all(nextProfiles.map(async (profile) => {
        await fetchRunStatus(profile.id)
      }))
    } catch (error) {
      reportUiError('Failed to load search profiles', error)
      toast.error(t('searchProfiles.loadError', { defaultValue: 'Failed to load profiles' }))
    } finally {
      setLoading(false)
    }
  }, [fetchProfileDetail, fetchRunStatus, t])

  useEffect(() => {
    void loadProfiles()
  }, [loadProfiles])

  useEffect(() => {
    const pollTimers = pollTimersRef.current
    const headModeResetTimers = headModeResetTimersRef.current
    const runNowLocks = runNowLocksRef.current

    return () => {
      Object.values(pollTimers).forEach((timer) => clearInterval(timer))
      Object.keys(pollTimers).forEach((profileId) => delete pollTimers[profileId])
      Object.values(headModeResetTimers).forEach((timer) => clearTimeout(timer))
      Object.keys(headModeResetTimers).forEach((profileId) => delete headModeResetTimers[profileId])
      runNowLocks.clear()
    }
  }, [])

  const updateSearchParams = useCallback((mutate: (params: URLSearchParams) => void) => {
    const nextParams = new URLSearchParams(searchParams)
    mutate(nextParams)
    setSearchParams(nextParams, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    if (searchParams.get('view') !== 'quick-starts') {
      return
    }

    updateSearchParams((nextParams) => {
      nextParams.delete('view')
    })
  }, [searchParams, updateSearchParams])

  const handleCreate = useCallback(() => {
    setEditingProfileId(null)
    updateSearchParams((nextParams) => {
      nextParams.delete('edit')
    })
    setEditorOpen(true)
  }, [updateSearchParams])

  const handleEdit = useCallback((profileId: string) => {
    setEditingProfileId(profileId)
    updateSearchParams((nextParams) => {
      nextParams.set('edit', profileId)
    })
    setEditorOpen(true)
  }, [updateSearchParams])

  const handleDelete = useCallback((profileId: string) => {
    setDeletingProfileId(profileId)
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!deletingProfileId) {
      return
    }

    const profileId = deletingProfileId
    const { data } = await rawApiClient.DELETE<{ success: boolean }>(`/api/search-profiles/${profileId}`)
    if (!data?.success) {
      toast.error(t('searchProfiles.deleteError', { defaultValue: 'Failed to delete profile' }))
      setDeletingProfileId(null)
      return
    }

    clearPolling(profileId)
    setRunningIds((previous) => {
      if (!previous.has(profileId)) {
        return previous
      }
      const next = new Set(previous)
      next.delete(profileId)
      return next
    })
    setRunStatuses((previous) => {
      if (!(profileId in previous)) {
        return previous
      }
      const next = { ...previous }
      delete next[profileId]
      return next
    })
    setProfileDetails((previous) => {
      if (!(profileId in previous)) {
        return previous
      }
      const next = { ...previous }
      delete next[profileId]
      return next
    })
    setProfiles((previous) => previous.filter((profile) => profile.id !== profileId))

    toast.success(t('searchProfiles.deleteSuccess', { defaultValue: 'Profile deleted' }))
    setDeletingProfileId(null)
  }, [clearPolling, deletingProfileId, t])

  const handleRunNow = useCallback(async (profileId: string) => {
    if (runNowLocksRef.current.has(profileId)) {
      return
    }
    runNowLocksRef.current.add(profileId)

    const detail = profileDetails[profileId] ?? await fetchProfileDetail(profileId)
    if (!detail) {
      runNowLocksRef.current.delete(profileId)
      toast.error(t('searchProfiles.loadDetailError', { defaultValue: 'Failed to load profile details' }))
      return
    }
    const activeSource = getActiveSearchProfileSource(detail.sources)

    const isHeadMode = !detail.collectionMode || detail.collectionMode === 'head'

    if (isHeadMode && activeSource) {
      if (activeSource.type === SEARCH_PROFILE_SOURCE_TYPES.seek) {
        if (resolveSeekModeFromUrl(activeSource.jobUrl) === null) {
          runNowLocksRef.current.delete(profileId)
          toast.error(t('searchProfiles.seekJobUrlMissing', { defaultValue: 'Seek Run Now requires a recognized Seek URL (recommended candidates or talent search).' }))
          return
        }
      }

      const launchUrl = buildCollectionLaunchUrl({
        source: {
          type: activeSource.type as CollectionSourceType,
          exactUrl: activeSource.jobUrl,
          unsafeLimits: activeSource.unsafeLimits,
          job51CollectLimit: activeSource.job51CollectLimit,
          job51MaxPages: activeSource.job51MaxPages,
          collectLimit: activeSource.collectLimit,
          maxPages: activeSource.maxPages,
        },
        location: detail.location,
        keywords: detail.keywords,
        collectLimit: detail.schedule?.maxCandidates ?? DEFAULT_PROFILE_RUN_LIMIT,
        maxPages: DEFAULT_PROFILE_RUN_MAX_PAGES,
        minAge: detail.filters?.minAge,
        maxAge: detail.filters?.maxAge,
      })

      if (!launchUrl) {
        runNowLocksRef.current.delete(profileId)
        toast.error(t('searchProfiles.buildUrlError', { defaultValue: 'Failed to build collection URL.' }))
        return
      }

      const finalLaunchUrl = (() => {
        const url = new URL(launchUrl)
        url.searchParams.set('tr_search_profile_id', profileId)
        if (activeSource.type === SEARCH_PROFILE_SOURCE_TYPES.job51) {
          url.searchParams.set('tr_job51_detail_wait', 'page1')
        }
        return url.toString()
      })()

      setRunningIds((previous) => new Set(previous).add(profileId))
      window.open(finalLaunchUrl, `trends-collect-${activeSource.type}`, 'noopener,noreferrer')
      toast.success(t('searchProfiles.openTabSuccess', { defaultValue: 'Opened collection in a new tab' }))
      const existingTimer = headModeResetTimersRef.current[profileId]
      if (existingTimer) {
        clearTimeout(existingTimer)
      }
      headModeResetTimersRef.current[profileId] = setTimeout(() => {
        clearHeadModePendingRun(profileId)
      }, 2000)
      return
    }

    // Headless (background crawler) path — guard with feature flag
    if (!isHeadlessCollectorEnabled()) {
      runNowLocksRef.current.delete(profileId)
      toast.error(t('searchProfiles.headlessDisabled', { defaultValue: 'Background crawler is not enabled. Set VITE_ENABLE_HEADLESS_COLLECTOR=true to use headless collection.' }))
      return
    }

    setRunningIds((previous) => new Set(previous).add(profileId))

    try {
      const { data, error } = await rawApiClient.POST<RunProfileResponse>(`/api/search-profiles/${profileId}/run`, {
        body: {},
      })

      if (!data?.success) {
        const rawMessage = (data && 'error' in data ? readString(data.error) : null)
          || extractApiErrorMessage(error)
        const message = isLikelyNetworkError(rawMessage)
          ? t('searchProfiles.runNetworkError', { defaultValue: 'Cannot reach API server. Start make dev or make dev-api.' })
          : (rawMessage || t('searchProfiles.runError', { defaultValue: 'Failed to run profile' }))
        toast.error(message)
        runNowLocksRef.current.delete(profileId)
        setRunningIds((previous) => {
          if (!previous.has(profileId)) {
            return previous
          }
          const next = new Set(previous)
          next.delete(profileId)
          return next
        })
        return
      }

      toast.success(t('searchProfiles.runSuccess', { defaultValue: 'Profile run started' }))
      startPolling(profileId)
      runNowLocksRef.current.delete(profileId)
    } catch (error) {
      reportUiError(`Failed to run profile ${profileId}`, error)
      const rawMessage = extractApiErrorMessage(error)
      const message = isLikelyNetworkError(rawMessage)
        ? t('searchProfiles.runNetworkError', { defaultValue: 'Cannot reach API server. Start make dev or make dev-api.' })
        : (rawMessage || t('searchProfiles.runError', { defaultValue: 'Failed to run profile' }))
      toast.error(message)
      runNowLocksRef.current.delete(profileId)
      setRunningIds((previous) => {
        if (!previous.has(profileId)) {
          return previous
        }
        const next = new Set(previous)
        next.delete(profileId)
        return next
      })
    }
  }, [clearHeadModePendingRun, fetchProfileDetail, profileDetails, startPolling, t])



  useEffect(() => {
    const editId = searchParams.get('edit')
    if (!editId) {
      return
    }

    const exists = profiles.some((profile) => profile.id === editId)
    if (!exists) {
      return
    }

    setEditingProfileId((previous) => (previous === editId ? previous : editId))
    setEditorOpen(true)
  }, [profiles, searchParams])

  const handleEditorOpenChange = useCallback((open: boolean) => {
    setEditorOpen(open)
    if (open) {
      return
    }

    const activeEditId = searchParams.get('edit')
    setEditingProfileId(activeEditId ? null : editingProfileId)
    if (activeEditId) {
      updateSearchParams((nextParams) => {
        nextParams.delete('edit')
      })
      setEditingProfileId(null)
    }
  }, [editingProfileId, searchParams, updateSearchParams])

  const cards = useMemo(() => {
    return profiles.map((profile) => {
      const detail = profileDetails[profile.id]
      return {
        profile,
        scheduleLabel: buildScheduleLabel(detail),
        runStatus: runStatuses[profile.id],
      }
    })
  }, [profileDetails, profiles, runStatuses])

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('searchProfiles.title', { defaultValue: 'Search Profiles' })}
        description={t('searchProfiles.subtitle', { defaultValue: 'Manage landing quick starts and scheduled profile-based resume searches.' })}
        actions={
          <>
            <Button variant="outline" onClick={() => void loadProfiles()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              {t('searchProfiles.refresh', { defaultValue: 'Refresh' })}
            </Button>
            <Button onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" />
              {t('searchProfiles.create', { defaultValue: 'Create Profile' })}
            </Button>
          </>
        }
      />

      {loading ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {t('searchProfiles.loading', { defaultValue: 'Loading profiles...' })}
          </CardContent>
        </Card>
      ) : cards.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('searchProfiles.emptyTitle', { defaultValue: 'No profiles yet' })}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {t('searchProfiles.emptyDescription', { defaultValue: 'Create your first profile to enable one-click and scheduled runs.' })}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {cards.map(({ profile, scheduleLabel, runStatus }) => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              scheduleLabel={scheduleLabel}
              runStatus={runStatus}
              running={runningIds.has(profile.id)}
              onRunNow={handleRunNow}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <SearchProfileEditorDialog
        open={editorOpen}
        onOpenChange={handleEditorOpenChange}
        profileId={editingProfileId}
        onSaved={loadProfiles}
      />

      <Dialog open={!!deletingProfileId} onOpenChange={(open: boolean) => !open && setDeletingProfileId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t('searchProfiles.deleteTitle', { defaultValue: 'Confirm Deletion' })}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            {t('searchProfiles.deleteConfirm', { defaultValue: 'Delete this profile?' })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingProfileId(null)}>
              {t('searchProfiles.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <DialogClose asChild>
              <Button variant="destructive" onClick={() => void confirmDelete()}>
                {t('searchProfiles.deleteBtn', { defaultValue: 'Delete' })}
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
