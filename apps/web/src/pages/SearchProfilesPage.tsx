import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { rawApiClient } from '@/lib/api-helpers'
import { ProfileCard, type SearchProfileRunStatus, type SearchProfileSummary } from '@/components/ProfileCard'
import { JobDescriptionSelect } from '@/components/JobDescriptionSelect'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'

type SearchProfileDetails = {
  id: string
  name: string
  status: 'active' | 'paused' | 'archived'
  location: string
  keywords: string[]
  jobDescription?: string
  filterPreset?: string
  schedule?: {
    enabled: boolean
    cron?: string
  }
}

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

type ProfileFormState = {
  name: string
  location: string
  keywordsText: string
  jobDescription: string
  cron: string
  enabled: boolean
}

const DEFAULT_FORM: ProfileFormState = {
  name: '',
  location: '东莞',
  keywordsText: '',
  jobDescription: '',
  cron: '0 9 * * 1-5',
  enabled: true,
}

const TERMINAL_STATUSES: Array<SearchProfileRunStatus['taskStatus']> = ['completed', 'failed', 'cancelled', 'unknown']

function parseKeywords(value: string): string[] {
  return value
    .split(/[\s,，、]+/)
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0)
}

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

function toFormState(profile: SearchProfileDetails): ProfileFormState {
  return {
    name: profile.name,
    location: profile.location,
    keywordsText: profile.keywords.join(' '),
    jobDescription: profile.jobDescription || '',
    cron: profile.schedule?.cron || '',
    enabled: profile.status === 'active',
  }
}

export function SearchProfilesPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [profiles, setProfiles] = useState<SearchProfileSummary[]>([])
  const [profileDetails, setProfileDetails] = useState<Record<string, SearchProfileDetails>>({})
  const [runStatuses, setRunStatuses] = useState<Record<string, SearchProfileRunStatus>>({})
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set())
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [form, setForm] = useState<ProfileFormState>(DEFAULT_FORM)

  const pollTimersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({})

  const clearPolling = useCallback((profileId: string) => {
    const timer = pollTimersRef.current[profileId]
    if (timer) {
      clearInterval(timer)
      delete pollTimersRef.current[profileId]
    }
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
      console.error(`Failed to load run status for profile ${profileId}`, error)
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
          const { data: detailData } = await rawApiClient.GET<ProfileResponse>(`/api/search-profiles/${profile.id}`)
          if (!detailData?.success || !detailData.profile) {
            return null
          }
          return [profile.id, detailData.profile] as const
        })
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
      console.error('Failed to load search profiles', error)
      toast.error(t('searchProfiles.loadError', { defaultValue: 'Failed to load profiles' }))
    } finally {
      setLoading(false)
    }
  }, [fetchRunStatus, t])

  useEffect(() => {
    void loadProfiles()
  }, [loadProfiles])

  useEffect(() => {
    return () => {
      Object.values(pollTimersRef.current).forEach((timer) => clearInterval(timer))
      pollTimersRef.current = {}
    }
  }, [])

  const handleCreate = useCallback(() => {
    setEditingProfileId(null)
    setForm(DEFAULT_FORM)
    setEditorOpen(true)
  }, [])

  const handleEdit = useCallback(async (profileId: string) => {
    const cached = profileDetails[profileId]
    if (cached) {
      setEditingProfileId(profileId)
      setForm(toFormState(cached))
      setEditorOpen(true)
      return
    }

    const { data } = await rawApiClient.GET<ProfileResponse>(`/api/search-profiles/${profileId}`)
    const profile = data?.profile
    if (!data?.success || !profile) {
      toast.error(t('searchProfiles.loadDetailError', { defaultValue: 'Failed to load profile details' }))
      return
    }

    setProfileDetails((previous) => ({
      ...previous,
      [profileId]: profile,
    }))
    setEditingProfileId(profileId)
    setForm(toFormState(profile))
    setEditorOpen(true)
  }, [profileDetails, t])

  const handleDelete = useCallback(async (profileId: string) => {
    const confirmed = window.confirm(t('searchProfiles.deleteConfirm', { defaultValue: 'Delete this profile?' }))
    if (!confirmed) {
      return
    }

    const { data } = await rawApiClient.DELETE<{ success: boolean }>(`/api/search-profiles/${profileId}`)
    if (!data?.success) {
      toast.error(t('searchProfiles.deleteError', { defaultValue: 'Failed to delete profile' }))
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

    toast.success(t('searchProfiles.deleteSuccess', { defaultValue: 'Profile deleted' }))
    void loadProfiles()
  }, [clearPolling, loadProfiles, t])

  const handleRunNow = useCallback(async (profileId: string) => {
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
    } catch (error) {
      console.error(`Failed to run profile ${profileId}`, error)
      const rawMessage = extractApiErrorMessage(error)
      const message = isLikelyNetworkError(rawMessage)
        ? t('searchProfiles.runNetworkError', { defaultValue: 'Cannot reach API server. Start make dev or make dev-api.' })
        : (rawMessage || t('searchProfiles.runError', { defaultValue: 'Failed to run profile' }))
      toast.error(message)
      setRunningIds((previous) => {
        if (!previous.has(profileId)) {
          return previous
        }
        const next = new Set(previous)
        next.delete(profileId)
        return next
      })
    }
  }, [startPolling, t])

  const handleSave = useCallback(async () => {
    const keywords = parseKeywords(form.keywordsText)
    if (!form.name.trim() || !form.location.trim() || keywords.length === 0) {
      toast.error(t('searchProfiles.validationError', { defaultValue: 'Name, location and keywords are required' }))
      return
    }

    const payload = {
      name: form.name.trim(),
      location: form.location.trim(),
      keywords,
      status: form.enabled ? 'active' : 'paused',
      jobDescription: form.jobDescription.trim() || undefined,
      schedule: {
        enabled: form.enabled,
        cron: form.cron.trim() || undefined,
      },
    }

    setSubmitting(true)
    try {
      if (editingProfileId) {
        const { data } = await rawApiClient.PUT<{ success: boolean }>(`/api/search-profiles/${editingProfileId}`, {
          body: payload,
        })
        if (!data?.success) {
          throw new Error('Failed to update profile')
        }
      } else {
        const { data } = await rawApiClient.POST<{ success: boolean }>('/api/search-profiles', {
          body: payload,
        })
        if (!data?.success) {
          throw new Error('Failed to create profile')
        }
      }

      setEditorOpen(false)
      setEditingProfileId(null)
      setForm(DEFAULT_FORM)
      toast.success(t('searchProfiles.saveSuccess', { defaultValue: 'Profile saved' }))
      await loadProfiles()
    } catch (error) {
      console.error('Failed to save profile', error)
      toast.error(t('searchProfiles.saveError', { defaultValue: 'Failed to save profile' }))
    } finally {
      setSubmitting(false)
    }
  }, [editingProfileId, form, loadProfiles, t])

  useEffect(() => {
    const editId = searchParams.get('edit')
    if (!editId) {
      return
    }

    const exists = profiles.some((profile) => profile.id === editId)
    if (!exists) {
      return
    }

    void handleEdit(editId)
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('edit')
    setSearchParams(nextParams, { replace: true })
  }, [handleEdit, profiles, searchParams, setSearchParams])

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('searchProfiles.title', { defaultValue: 'Search Profiles' })}</h1>
          <p className="text-sm text-muted-foreground">
            {t('searchProfiles.subtitle', { defaultValue: 'Manage scheduled profile-based resume searches.' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void loadProfiles()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            {t('searchProfiles.refresh', { defaultValue: 'Refresh' })}
          </Button>
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            {t('searchProfiles.create', { defaultValue: 'Create Profile' })}
          </Button>
        </div>
      </div>

      {loading ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {t('searchProfiles.loading', { defaultValue: 'Loading profiles...' })}
          </CardContent>
        </Card>
      ) : cards.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('searchProfiles.emptyTitle', { defaultValue: 'No profiles yet' })}</CardTitle>
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

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editingProfileId
                ? t('searchProfiles.editTitle', { defaultValue: 'Edit Profile' })
                : t('searchProfiles.createTitle', { defaultValue: 'Create Profile' })}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="profile-name">{t('searchProfiles.fields.name', { defaultValue: 'Name' })}</Label>
              <Input
                id="profile-name"
                value={form.name}
                onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="profile-location">{t('searchProfiles.fields.location', { defaultValue: 'Location' })}</Label>
              <Input
                id="profile-location"
                value={form.location}
                onChange={(event) => setForm((previous) => ({ ...previous, location: event.target.value }))}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="profile-keywords">{t('searchProfiles.fields.keywords', { defaultValue: 'Keywords' })}</Label>
              <Input
                id="profile-keywords"
                value={form.keywordsText}
                onChange={(event) => setForm((previous) => ({ ...previous, keywordsText: event.target.value }))}
                placeholder={t('searchProfiles.fields.keywordsPlaceholder', { defaultValue: 'e.g. 车床 销售 CNC' })}
              />
            </div>

            <div className="grid gap-2">
              <Label>{t('searchProfiles.fields.jobDescription', { defaultValue: 'Job Description' })}</Label>
              <JobDescriptionSelect
                value={form.jobDescription}
                onChange={(value) => setForm((previous) => ({ ...previous, jobDescription: value }))}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="profile-cron">{t('searchProfiles.fields.cron', { defaultValue: 'Cron Expression' })}</Label>
              <Input
                id="profile-cron"
                value={form.cron}
                onChange={(event) => setForm((previous) => ({ ...previous, cron: event.target.value }))}
                placeholder="0 9 * * 1-5"
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                checked={form.enabled}
                onCheckedChange={(checked) => setForm((previous) => ({ ...previous, enabled: checked === true }))}
                id="profile-enabled"
              />
              <Label htmlFor="profile-enabled">{t('searchProfiles.fields.enabled', { defaultValue: 'Enabled' })}</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              {t('searchProfiles.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button onClick={() => void handleSave()} disabled={submitting}>
              {submitting
                ? t('searchProfiles.saving', { defaultValue: 'Saving...' })
                : t('searchProfiles.save', { defaultValue: 'Save' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
