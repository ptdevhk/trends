import { useCallback, useEffect, useState } from 'react'
import { Plus, RefreshCw, RotateCcw, Send, Sparkles, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { PageHeader } from '@/components/PageHeader'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { rawApiClient } from '@/lib/api-helpers'
import type { paths } from '@/lib/api-types'
import { reportUiError } from '@/lib/ui-error-reporting'

type SummaryRunListResponse = paths['/api/summaries/runs']['get']['responses'][200]['content']['application/json']
type SummaryRunDetailResponse = paths['/api/summaries/runs/{runId}']['get']['responses'][200]['content']['application/json']
type SummaryRunRequest = NonNullable<paths['/api/summaries/run']['post']['requestBody']>['content']['application/json']
type SummaryRunResponse = paths['/api/summaries/run']['post']['responses'][200]['content']['application/json']
type SummaryProfileListResponse = paths['/api/summaries/profiles']['get']['responses'][200]['content']['application/json']
type SummaryProfileCreateRequest = NonNullable<paths['/api/summaries/profiles']['post']['requestBody']>['content']['application/json']
type SummaryProfileCreateResponse = paths['/api/summaries/profiles']['post']['responses'][201]['content']['application/json']
type SummaryProfileUpdateRequest = NonNullable<paths['/api/summaries/profiles/{profileId}']['put']['requestBody']>['content']['application/json']
type SummaryProfileUpdateResponse = paths['/api/summaries/profiles/{profileId}']['put']['responses'][200]['content']['application/json']
type SummaryProfileDeleteResponse = paths['/api/summaries/profiles/{profileId}']['delete']['responses'][200]['content']['application/json']
type SummaryRunItem = SummaryRunListResponse['items'][number]
type SummaryRunDetailItem = SummaryRunDetailResponse['item']
type SummaryDelivery = NonNullable<SummaryRunDetailItem['delivery']>
type SummaryDeliveryAccount = NonNullable<SummaryDelivery['accounts']>[number]
type SummaryPeriod = NonNullable<SummaryRunRequest['period']>
type SummaryChannel = NonNullable<SummaryRunRequest['channel']>
type SummaryProfileItem = SummaryProfileListResponse['profiles'][number]
type SummaryRunFormState = {
  period: SummaryPeriod
  channel: SummaryChannel
  templateId: string
  endAt: string
  to: string
  subject: string
  webhookUrl: string
  botToken: string
  chatId: string
}
type SummaryProfileFormState = {
  id: string
  name: string
  enabled: boolean
  cron: string
  period: SummaryPeriod
  channel: SummaryChannel
  dryRun: boolean
  templateId: string
  to: string
  subject: string
}

const SUMMARY_RUN_LIST_LIMIT = 20
const DEFAULT_SUMMARY_RUN_FORM: SummaryRunFormState = {
  period: 'daily',
  channel: 'telegram',
  templateId: '',
  endAt: '',
  to: '',
  subject: '',
  webhookUrl: '',
  botToken: '',
  chatId: '',
}
const DEFAULT_SUMMARY_PROFILE_FORM: SummaryProfileFormState = {
  id: '',
  name: '',
  enabled: false,
  cron: '0 9 * * 1-5',
  period: 'daily',
  channel: 'telegram',
  dryRun: true,
  templateId: '',
  to: '',
  subject: '',
}

const SUMMARY_PERIOD_OPTIONS: Array<{ value: SummaryPeriod; label: string }> = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
]

const SUMMARY_CHANNEL_OPTIONS: Array<{ value: SummaryChannel; label: string }> = [
  { value: 'telegram', label: 'Telegram' },
  { value: 'wechat_work', label: 'WeChat Work' },
  { value: 'feishu', label: 'Feishu' },
  { value: 'email', label: 'Email' },
]

function isSummaryPeriod(value: string): value is SummaryPeriod {
  return value === 'daily' || value === 'weekly'
}

function isSummaryChannel(value: string): value is SummaryChannel {
  return value === 'telegram' || value === 'wechat_work' || value === 'feishu' || value === 'email'
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

  return readString(error.error)
}

function normalizeOptionalString(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function formatTimestamp(value: string | undefined): string {
  if (!value) {
    return '—'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}

function formatPeriodLabel(period: SummaryRunItem['period'] | SummaryRunDetailItem['period'] | undefined): string {
  if (period === 'weekly') {
    return 'Weekly'
  }
  return 'Daily'
}

function formatDelta(value: number | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '0'
  }
  return value > 0 ? `+${value}` : String(value)
}

function formatComparisonLabel(period: SummaryRunDetailItem['period'] | undefined): string {
  return period === 'weekly' ? 'Compared with previous week' : 'Compared with previous day'
}

function formatDeliverySummary(delivery: SummaryRunItem['delivery']): string {
  if (!delivery) {
    return '—'
  }

  if (delivery.messageId) {
    return `message ${delivery.messageId}`
  }

  if (
    typeof delivery.accountsSent === 'number'
    || typeof delivery.accountsAttempted === 'number'
    || typeof delivery.accountsSelected === 'number'
  ) {
    const denominator = delivery.accountsAttempted || delivery.accountsSelected || delivery.accountsConfigured || 0
    const sent = delivery.accountsSent || 0
    const parts = [`${sent}/${denominator} sent`]

    if (typeof delivery.totalBatches === 'number' && delivery.totalBatches > 0) {
      parts.push(`${delivery.totalBatches} batches`)
    }

    if (delivery.usedOverrideBotToken || delivery.usedOverrideChatId) {
      parts.push('override')
    }

    return parts.join(' • ')
  }

  if (delivery.channel) {
    return delivery.channel
  }

  if (delivery.ok) {
    return 'ok'
  }

  return 'available'
}

function formatAccountStatus(account: SummaryDeliveryAccount): string {
  if (account.sent) {
    return 'sent'
  }
  if (account.attempted) {
    return 'failed'
  }
  return 'skipped'
}

function formatComparisonSummary(item: SummaryRunDetailItem | null): string {
  const comparison = item?.report.comparison
  if (!comparison) {
    return '—'
  }

  const shared = comparison.totalsDelta.sharedIngest
  const workspace = comparison.totalsDelta.workspaceActivity
  return [
    `${formatComparisonLabel(item?.report.period)}`,
    `shared ingest ${formatDelta(shared.newResumes)} resumes`,
    `workspace ${formatDelta(workspace.candidateStatusUpdates)} status`,
  ].join(' • ')
}

function getRunStatusVariant(status: SummaryRunItem['status']) {
  if (status === 'failed') {
    return 'destructive' as const
  }
  if (status === 'sent') {
    return 'default' as const
  }
  if (status === 'dry_run') {
    return 'secondary' as const
  }
  return 'outline' as const
}

function mergeRunIntoList(runs: SummaryRunItem[], run: SummaryRunDetailItem): SummaryRunItem[] {
  return [run, ...runs.filter((item) => item.id !== run.id)].slice(0, SUMMARY_RUN_LIST_LIMIT)
}

function createEmptyProfileForm(): SummaryProfileFormState {
  return { ...DEFAULT_SUMMARY_PROFILE_FORM }
}

function toProfileFormState(profile: SummaryProfileItem): SummaryProfileFormState {
  return {
    id: profile.id,
    name: profile.name,
    enabled: profile.enabled,
    cron: profile.schedule.cron,
    period: profile.request.period,
    channel: profile.request.channel,
    dryRun: profile.request.dryRun,
    templateId: profile.request.templateId ?? '',
    to: profile.request.to ?? '',
    subject: profile.request.subject ?? '',
  }
}

function formatChannelLabel(channel: SummaryChannel): string {
  return SUMMARY_CHANNEL_OPTIONS.find((option) => option.value === channel)?.label ?? channel
}

function formatProfileDelivery(profile: SummaryProfileItem): string {
  if (profile.request.channel === 'email') {
    return profile.request.to ?? 'Email recipient required'
  }

  return `${formatChannelLabel(profile.request.channel)} env defaults`
}

function getProfileStatusVariant(enabled: boolean) {
  return enabled ? 'default' as const : 'outline' as const
}

function getProfileModeVariant(dryRun: boolean) {
  return dryRun ? 'secondary' as const : 'outline' as const
}

function upsertProfile(profiles: SummaryProfileItem[], nextProfile: SummaryProfileItem): SummaryProfileItem[] {
  const existingIndex = profiles.findIndex((profile) => profile.id === nextProfile.id)
  if (existingIndex === -1) {
    return [...profiles, nextProfile]
  }

  return profiles.map((profile) => (
    profile.id === nextProfile.id ? nextProfile : profile
  ))
}

export function SummaryRunsPage() {
  const { t } = useTranslation()
  const { teamSlug } = useParams()
  const [runs, setRuns] = useState<SummaryRunItem[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedRun, setSelectedRun] = useState<SummaryRunDetailItem | null>(null)
  const [runForm, setRunForm] = useState<SummaryRunFormState>(DEFAULT_SUMMARY_RUN_FORM)
  const [profiles, setProfiles] = useState<SummaryProfileItem[]>([])
  const [profileForm, setProfileForm] = useState<SummaryProfileFormState>(createEmptyProfileForm)
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [profilesLoading, setProfilesLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [submittingMode, setSubmittingMode] = useState<'preview' | 'send' | null>(null)
  const [profileSubmittingMode, setProfileSubmittingMode] = useState<'create' | 'update' | 'delete' | null>(null)
  const operationsHref = `/${teamSlug ?? 'dev'}/system/settings/operations`

  const loadRunDetail = useCallback(async (runId: string) => {
    setDetailLoading(true)
    try {
      const { data, error } = await rawApiClient.GET<SummaryRunDetailResponse>(`/api/summaries/runs/${encodeURIComponent(runId)}`)
      if (error || !data?.success) {
        throw new Error(extractApiErrorMessage(error) ?? 'Failed to load summary run detail')
      }
      setSelectedRun(data.item)
    } catch (error) {
      reportUiError(`Failed to load summary run detail ${runId}`, error)
      toast.error(error instanceof Error ? error.message : t('summaries.errors.loadRunDetailFailed', { defaultValue: 'Failed to load summary run detail' }))
      setSelectedRun(null)
    } finally {
      setDetailLoading(false)
    }
    // t is i18n; intentionally omit from deps to avoid remount loops when t identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadRuns = useCallback(async (preferredRunId?: string) => {
    setLoading(true)
    try {
      const { data, error } = await rawApiClient.GET<SummaryRunListResponse>('/api/summaries/runs', {
        params: {
          query: {
            limit: SUMMARY_RUN_LIST_LIMIT,
          },
        },
      })
      if (error || !data?.success) {
        throw new Error(extractApiErrorMessage(error) ?? 'Failed to load summary runs')
      }

      const items = data.items || []
      setRuns(items)

      const nextSelectedRunId = preferredRunId
        && items.some((item) => item.id === preferredRunId)
        ? preferredRunId
        : items[0]?.id ?? null

      setSelectedRunId(nextSelectedRunId)

      if (nextSelectedRunId) {
        await loadRunDetail(nextSelectedRunId)
      } else {
        setSelectedRun(null)
      }
    } catch (error) {
      reportUiError('Failed to load summary runs', error)
      toast.error(error instanceof Error ? error.message : t('summaries.errors.loadRunsFailed', { defaultValue: 'Failed to load summary runs' }))
      setRuns([])
      setSelectedRunId(null)
      setSelectedRun(null)
    } finally {
      setLoading(false)
    }
    // t is i18n; intentionally omit from deps to avoid remount loops when t identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRunDetail])

  useEffect(() => {
    void loadRuns()
  }, [loadRuns])

  const loadProfiles = useCallback(async (preferredProfileId?: string | null) => {
    setProfilesLoading(true)
    try {
      const { data, error } = await rawApiClient.GET<SummaryProfileListResponse>('/api/summaries/profiles')
      if (error || !data?.success) {
        throw new Error(extractApiErrorMessage(error) ?? 'Failed to load summary profiles')
      }

      const items = data.profiles || []
      setProfiles(items)

      const nextEditingProfileId = preferredProfileId && items.some((profile) => profile.id === preferredProfileId)
        ? preferredProfileId
        : items[0]?.id ?? null

      if (nextEditingProfileId) {
        const nextProfile = items.find((profile) => profile.id === nextEditingProfileId)
        if (nextProfile) {
          setEditingProfileId(nextProfile.id)
          setProfileForm(toProfileFormState(nextProfile))
        }
      } else {
        setEditingProfileId(null)
        setProfileForm(createEmptyProfileForm())
      }
    } catch (error) {
      reportUiError('Failed to load summary profiles', error)
      toast.error(error instanceof Error ? error.message : t('summaries.errors.loadProfilesFailed', { defaultValue: 'Failed to load summary profiles' }))
      setProfiles([])
      setEditingProfileId(null)
      setProfileForm(createEmptyProfileForm())
    } finally {
      setProfilesLoading(false)
    }
    // t is i18n; intentionally omit from deps to avoid remount loops when t identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void loadProfiles()
  }, [loadProfiles])

  const selectedRunSummary = formatDeliverySummary(selectedRun?.delivery)
  const selectedRunComparisonSummary = formatComparisonSummary(selectedRun)
  const submittingPreview = submittingMode === 'preview'
  const submittingSend = submittingMode === 'send'
  const submitting = submittingMode !== null
  const editingExistingProfile = editingProfileId !== null
  const profileSubmitting = profileSubmittingMode !== null
  const profileSubmittingCreate = profileSubmittingMode === 'create'
  const profileSubmittingUpdate = profileSubmittingMode === 'update'
  const profileSubmittingDelete = profileSubmittingMode === 'delete'
  const profileSubmitLabel = profileSubmittingCreate
    ? t('summaries.profileCreating', { defaultValue: 'Creating…' })
    : profileSubmittingUpdate
      ? t('summaries.profileSaving', { defaultValue: 'Saving…' })
      : editingExistingProfile
        ? t('summaries.profileSave', { defaultValue: 'Save profile' })
        : t('summaries.profileCreate', { defaultValue: 'Create profile' })

  function updateRunForm<Key extends keyof SummaryRunFormState>(key: Key, value: SummaryRunFormState[Key]) {
    setRunForm((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function updateProfileForm<Key extends keyof SummaryProfileFormState>(key: Key, value: SummaryProfileFormState[Key]) {
    setProfileForm((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function resetProfileForm(profile: SummaryProfileItem | null) {
    if (profile) {
      setEditingProfileId(profile.id)
      setProfileForm(toProfileFormState(profile))
      return
    }

    setEditingProfileId(null)
    setProfileForm(createEmptyProfileForm())
  }

  function handleStartNewProfile() {
    resetProfileForm(null)
  }

  function handleSelectProfile(profileId: string) {
    const nextProfile = profiles.find((profile) => profile.id === profileId)
    if (!nextProfile) {
      return
    }

    resetProfileForm(nextProfile)
  }

  function buildRunRequest(dryRun: boolean): SummaryRunRequest {
    const request: SummaryRunRequest = {
      period: runForm.period,
      channel: runForm.channel,
      dryRun,
    }

    const templateId = normalizeOptionalString(runForm.templateId)
    if (templateId) {
      request.templateId = templateId
    }

    const endAt = normalizeOptionalString(runForm.endAt)
    if (endAt) {
      request.endAt = endAt
    }

    if (runForm.channel === 'email') {
      const to = normalizeOptionalString(runForm.to)
      if (to) {
        request.to = to
      }

      const subject = normalizeOptionalString(runForm.subject)
      if (subject) {
        request.subject = subject
      }
    }

    if (runForm.channel === 'wechat_work' || runForm.channel === 'feishu') {
      const webhookUrl = normalizeOptionalString(runForm.webhookUrl)
      if (webhookUrl) {
        request.webhookUrl = webhookUrl
      }
    }

    if (runForm.channel === 'telegram') {
      const botToken = normalizeOptionalString(runForm.botToken)
      if (botToken) {
        request.botToken = botToken
      }

      const chatId = normalizeOptionalString(runForm.chatId)
      if (chatId) {
        request.chatId = chatId
      }
    }

    return request
  }

  function buildProfileRequest():
  | { request: SummaryProfileCreateRequest | SummaryProfileUpdateRequest; validationError: null }
  | { request: null; validationError: string } {
    const id = normalizeOptionalString(profileForm.id)
    if (!id) {
      return { request: null, validationError: 'Profile ID is required' }
    }

    const name = normalizeOptionalString(profileForm.name)
    if (!name) {
      return { request: null, validationError: 'Profile name is required' }
    }

    const cron = normalizeOptionalString(profileForm.cron)
    if (!cron) {
      return { request: null, validationError: 'Cron expression is required' }
    }

    const request: SummaryProfileCreateRequest = {
      id,
      name,
      enabled: profileForm.enabled,
      schedule: {
        cron,
      },
      request: {
        period: profileForm.period,
        channel: profileForm.channel,
        dryRun: profileForm.dryRun,
      },
    }

    const templateId = normalizeOptionalString(profileForm.templateId)
    if (templateId) {
      request.request.templateId = templateId
    }

    if (profileForm.channel === 'email') {
      const to = normalizeOptionalString(profileForm.to)
      if (!to) {
        return { request: null, validationError: 'Email recipient is required' }
      }

      request.request.to = to

      const subject = normalizeOptionalString(profileForm.subject)
      if (subject) {
        request.request.subject = subject
      }
    }

    return { request, validationError: null }
  }

  async function handleRunAction(mode: 'preview' | 'send') {
    setSubmittingMode(mode)
    try {
      const { data, error } = await rawApiClient.POST<SummaryRunResponse>('/api/summaries/run', {
        body: buildRunRequest(mode === 'preview'),
      })
      if (error || !data?.success) {
        throw new Error(extractApiErrorMessage(error) ?? `Failed to ${mode} summary`)
      }

      setRuns((current) => mergeRunIntoList(current, data.run))
      setSelectedRunId(data.run.id)
      setSelectedRun(data.run)
      toast.success(
        mode === 'preview'
          ? t('summaries.previewSuccess', { defaultValue: 'Summary preview generated' })
          : t('summaries.sendSuccess', { defaultValue: 'Summary sent' }),
      )
    } catch (error) {
      reportUiError(`Failed to ${mode} summary`, error)
      toast.error(
        error instanceof Error
          ? error.message
          : mode === 'preview'
            ? t('summaries.previewError', { defaultValue: 'Failed to preview summary' })
            : t('summaries.sendError', { defaultValue: 'Failed to send summary' }),
      )
    } finally {
      setSubmittingMode(null)
    }
  }

  async function handleSaveProfile() {
    const { request, validationError } = buildProfileRequest()
    if (validationError || !request) {
      toast.error(validationError ?? t('summaries.errors.invalidProfile', { defaultValue: 'Invalid summary profile' }))
      return
    }

    const nextMode = editingExistingProfile ? 'update' : 'create'
    setProfileSubmittingMode(nextMode)

    try {
      if (editingProfileId) {
        const { data, error } = await rawApiClient.PUT<SummaryProfileUpdateResponse>(
          `/api/summaries/profiles/${encodeURIComponent(editingProfileId)}`,
          {
            body: request,
          },
        )

        if (error || !data?.success) {
          throw new Error(extractApiErrorMessage(error) ?? 'Failed to save summary profile')
        }

        setProfiles((current) => upsertProfile(current, data.profile))
        resetProfileForm(data.profile)
      } else {
        const { data, error } = await rawApiClient.POST<SummaryProfileCreateResponse>('/api/summaries/profiles', {
          body: request,
        })

        if (error || !data?.success) {
          throw new Error(extractApiErrorMessage(error) ?? 'Failed to create summary profile')
        }

        setProfiles((current) => upsertProfile(current, data.profile))
        resetProfileForm(data.profile)
      }

      toast.success(editingExistingProfile
        ? t('summaries.profileSaved', { defaultValue: 'Summary profile saved' })
        : t('summaries.profileCreated', { defaultValue: 'Summary profile created' }))
    } catch (error) {
      reportUiError(`Failed to ${nextMode} summary profile`, error)
      toast.error(
        error instanceof Error
          ? error.message
          : editingExistingProfile
            ? t('summaries.errors.saveProfileFailed', { defaultValue: 'Failed to save summary profile' })
            : t('summaries.errors.createProfileFailed', { defaultValue: 'Failed to create summary profile' }),
      )
    } finally {
      setProfileSubmittingMode(null)
    }
  }

  async function handleDeleteProfile() {
    if (!editingProfileId) {
      return
    }

    setProfileSubmittingMode('delete')

    try {
      const { data, error } = await rawApiClient.DELETE<SummaryProfileDeleteResponse>(
        `/api/summaries/profiles/${encodeURIComponent(editingProfileId)}`,
      )

      if (error || !data?.success) {
        throw new Error(extractApiErrorMessage(error) ?? 'Failed to delete summary profile')
      }

      const nextProfiles = profiles.filter((profile) => profile.id !== editingProfileId)
      setProfiles(nextProfiles)
      resetProfileForm(nextProfiles[0] ?? null)
      toast.success(t('summaries.profileDeleted', { defaultValue: 'Summary profile deleted' }))
    } catch (error) {
      reportUiError(`Failed to delete summary profile ${editingProfileId}`, error)
      toast.error(error instanceof Error ? error.message : t('summaries.errors.deleteProfileFailed', { defaultValue: 'Failed to delete summary profile' }))
    } finally {
      setProfileSubmittingMode(null)
    }
  }

  function handleUseSelectedRun() {
    if (!selectedRun) {
      return
    }

    setRunForm({
      period: selectedRun.period,
      channel: selectedRun.channel ?? DEFAULT_SUMMARY_RUN_FORM.channel,
      templateId: selectedRun.templateId ?? '',
      endAt: selectedRun.windowEnd,
      to: '',
      subject: '',
      webhookUrl: '',
      botToken: '',
      chatId: '',
    })
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await Promise.all([
        loadRuns(selectedRunId ?? undefined),
        loadProfiles(editingProfileId),
      ])
    } finally {
      setRefreshing(false)
    }
  }

  async function handleSelectRun(runId: string) {
    if (runId === selectedRunId) {
      return
    }
    setSelectedRunId(runId)
    await loadRunDetail(runId)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('summaries.pageTitle', { defaultValue: 'Summary Runs' })}
        description={t('summaries.pageDescription', {
          defaultValue: 'Create scheduled summary profiles, validate sends manually, and inspect the persisted run history for the active workspace.',
        })}
        actions={(
          <Button variant="outline" onClick={() => void handleRefresh()} disabled={refreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing
              ? t('summaries.refreshing', { defaultValue: 'Refreshing…' })
              : t('summaries.refresh', { defaultValue: 'Refresh' })}
          </Button>
        )}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>{t('summaries.historyTitle', { defaultValue: 'Recent runs' })}</CardTitle>
            <CardDescription>
              {t('summaries.historyDescription', {
                defaultValue: 'The latest persisted summary runs for the active workspace, including dry-runs, previews, sends, and failures.',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-muted-foreground">{t('summaries.loading', { defaultValue: 'Loading summary runs…' })}</div>
            ) : runs.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t('summaries.empty', { defaultValue: 'No summary runs found yet.' })}</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('summaries.columnRun', { defaultValue: 'Run' })}</TableHead>
                    <TableHead>{t('summaries.columnPeriod', { defaultValue: 'Period' })}</TableHead>
                    <TableHead>{t('summaries.columnStatus', { defaultValue: 'Status' })}</TableHead>
                    <TableHead>{t('summaries.columnStarted', { defaultValue: 'Started' })}</TableHead>
                    <TableHead>{t('summaries.columnDelivery', { defaultValue: 'Delivery' })}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => {
                    const isSelected = run.id === selectedRunId
                    return (
                      <TableRow
                        key={run.id}
                        className="cursor-pointer"
                        data-state={isSelected ? 'selected' : undefined}
                        onClick={() => void handleSelectRun(run.id)}
                      >
                        <TableCell>
                          <div className="font-medium">{run.id}</div>
                          <div className="text-xs text-muted-foreground">
                            {run.triggerSource} • {run.channel || 'preview'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{formatPeriodLabel(run.period)}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={getRunStatusVariant(run.status)}>{run.status}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatTimestamp(run.startedAt)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDeliverySummary(run.delivery)}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6 min-w-0">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle>{t('summaries.profilesTitle', { defaultValue: 'Summary profiles' })}</CardTitle>
                  <CardDescription>
                    {t('summaries.profilesDescription', {
                      defaultValue: 'Save reusable scheduled summary profiles here, then validate the output with the manual run tools below before enabling them for worker restarts.',
                    })}
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleStartNewProfile}
                  disabled={profileSubmitting}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t('summaries.profileNew', { defaultValue: 'New profile' })}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-muted-foreground">
                <div className="font-medium text-foreground">
                  {t('summaries.profileRestartTitle', { defaultValue: 'Changes apply after the next worker restart.' })}
                </div>
                <div className="mt-1">
                  {t('summaries.profileRestartDescription', {
                    defaultValue: 'The scheduler rebuilds profile jobs on startup. The worker API does not live-reload summary profiles yet, and cron timing still uses the global worker timezone.',
                  })}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <p className="text-xs text-muted-foreground">
                    {t('summaries.profileRestartVisibilityHint', {
                      defaultValue: 'Runtime updates can take a few seconds after save. After restart, confirm the rebuilt job in worker status.',
                    })}
                  </p>
                  <Link
                    to={operationsHref}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    {t('summaries.profileOpenWorkerStatus', { defaultValue: 'Open worker status' })}
                  </Link>
                </div>
              </div>

              {profilesLoading ? (
                <div className="text-sm text-muted-foreground">{t('summaries.profilesLoading', { defaultValue: 'Loading summary profiles…' })}</div>
              ) : profiles.length === 0 ? (
                <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  {t('summaries.profilesEmpty', {
                    defaultValue: 'No summary profiles saved yet. Create one here, validate it with the manual preview/send tools below, and restart the worker when you are ready to activate it.',
                  })}
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('summaries.profileColumnProfile', { defaultValue: 'Profile' })}</TableHead>
                        <TableHead>{t('summaries.profileColumnSchedule', { defaultValue: 'Schedule' })}</TableHead>
                        <TableHead>{t('summaries.profileColumnDelivery', { defaultValue: 'Delivery' })}</TableHead>
                        <TableHead>{t('summaries.profileColumnState', { defaultValue: 'State' })}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {profiles.map((profile) => {
                        const isSelected = profile.id === editingProfileId
                        return (
                          <TableRow
                            key={profile.id}
                            className="cursor-pointer"
                            data-state={isSelected ? 'selected' : undefined}
                            onClick={() => handleSelectProfile(profile.id)}
                          >
                            <TableCell>
                              <div className="font-medium">{profile.name}</div>
                              <div className="text-xs font-mono text-muted-foreground">{profile.id}</div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{profile.schedule.cron}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{formatProfileDelivery(profile)}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-2">
                                <Badge variant={getProfileStatusVariant(profile.enabled)}>
                                  {profile.enabled ? 'enabled' : 'paused'}
                                </Badge>
                                <Badge variant={getProfileModeVariant(profile.request.dryRun)}>
                                  {profile.request.dryRun ? 'dry run' : 'send'}
                                </Badge>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="summary-profile-id">
                    {t('summaries.profileFormId', { defaultValue: 'Profile ID' })}
                  </Label>
                  <Input
                    id="summary-profile-id"
                    value={profileForm.id}
                    onChange={(event) => updateProfileForm('id', event.target.value)}
                    placeholder="daily-ops"
                    disabled={profileSubmitting || editingExistingProfile}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="summary-profile-name">
                    {t('summaries.profileFormName', { defaultValue: 'Profile name' })}
                  </Label>
                  <Input
                    id="summary-profile-name"
                    value={profileForm.name}
                    onChange={(event) => updateProfileForm('name', event.target.value)}
                    placeholder="Daily Ops"
                    disabled={profileSubmitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="summary-profile-cron">
                    {t('summaries.profileFormCron', { defaultValue: 'Cron expression' })}
                  </Label>
                  <Input
                    id="summary-profile-cron"
                    value={profileForm.cron}
                    onChange={(event) => updateProfileForm('cron', event.target.value)}
                    placeholder="0 9 * * 1-5"
                    disabled={profileSubmitting}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('summaries.profileFormCronHint', { defaultValue: 'Uses the global worker timezone.' })}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="summary-profile-template-id">
                    {t('summaries.profileFormTemplateId', { defaultValue: 'Profile template ID' })}
                  </Label>
                  <Input
                    id="summary-profile-template-id"
                    value={profileForm.templateId}
                    onChange={(event) => updateProfileForm('templateId', event.target.value)}
                    placeholder="summary-daily"
                    disabled={profileSubmitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="summary-profile-period">
                    {t('summaries.profileFormPeriod', { defaultValue: 'Profile period' })}
                  </Label>
                  <Select
                    id="summary-profile-period"
                    value={profileForm.period}
                    onChange={(event) => {
                      if (isSummaryPeriod(event.target.value)) {
                        updateProfileForm('period', event.target.value)
                      }
                    }}
                    options={SUMMARY_PERIOD_OPTIONS}
                    disabled={profileSubmitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="summary-profile-channel">
                    {t('summaries.profileFormChannel', { defaultValue: 'Profile channel' })}
                  </Label>
                  <Select
                    id="summary-profile-channel"
                    value={profileForm.channel}
                    onChange={(event) => {
                      if (isSummaryChannel(event.target.value)) {
                        updateProfileForm('channel', event.target.value)
                      }
                    }}
                    options={SUMMARY_CHANNEL_OPTIONS}
                    disabled={profileSubmitting}
                  />
                </div>
              </div>

              {profileForm.channel === 'email' ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="summary-profile-to">
                      {t('summaries.profileFormEmailTo', { defaultValue: 'Profile email recipient' })}
                    </Label>
                    <Input
                      id="summary-profile-to"
                      value={profileForm.to}
                      onChange={(event) => updateProfileForm('to', event.target.value)}
                      placeholder="ops@example.com"
                      disabled={profileSubmitting}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="summary-profile-subject">
                      {t('summaries.profileFormSubject', { defaultValue: 'Profile email subject' })}
                    </Label>
                    <Input
                      id="summary-profile-subject"
                      value={profileForm.subject}
                      onChange={(event) => updateProfileForm('subject', event.target.value)}
                      placeholder="Weekly Ops Summary"
                      disabled={profileSubmitting}
                    />
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  {t('summaries.profileDeliveryHint', {
                    defaultValue: 'Telegram, WeChat Work, and Feishu profiles use the existing environment-backed delivery defaults. Manual preview/send remains the fast validation path for one-off override testing.',
                  })}
                </div>
              )}

              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={profileForm.enabled}
                    onCheckedChange={(checked: boolean | 'indeterminate') => updateProfileForm('enabled', checked === true)}
                    disabled={profileSubmitting}
                  />
                  <span>{t('summaries.profileFormEnabled', { defaultValue: 'Enabled after restart' })}</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={profileForm.dryRun}
                    onCheckedChange={(checked: boolean | 'indeterminate') => updateProfileForm('dryRun', checked === true)}
                    disabled={profileSubmitting}
                  />
                  <span>{t('summaries.profileFormDryRun', { defaultValue: 'Dry run only' })}</span>
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => {
                    void handleSaveProfile()
                  }}
                  disabled={profileSubmitting}
                >
                  {profileSubmitLabel}
                </Button>
                {editingExistingProfile ? (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => {
                      void handleDeleteProfile()
                    }}
                    disabled={profileSubmitting}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {profileSubmittingDelete
                      ? t('summaries.profileDeleting', { defaultValue: 'Deleting…' })
                      : t('summaries.profileDelete', { defaultValue: 'Delete profile' })}
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle>{t('summaries.runTitle', { defaultValue: 'Run summary' })}</CardTitle>
                  <CardDescription>
                    {t('summaries.runDescription', {
                      defaultValue: 'Preview the outbound summary content as a dry-run, then send it through the selected channel using the existing summary ledger.',
                    })}
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleUseSelectedRun}
                  disabled={!selectedRun || submitting}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  {t('summaries.useSelectedRun', { defaultValue: 'Use selected run' })}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="summary-period">
                    {t('summaries.formPeriod', { defaultValue: 'Period' })}
                  </Label>
                  <Select
                    id="summary-period"
                    value={runForm.period}
                    onChange={(event) => {
                      if (isSummaryPeriod(event.target.value)) {
                        updateRunForm('period', event.target.value)
                      }
                    }}
                    options={SUMMARY_PERIOD_OPTIONS}
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="summary-channel">
                    {t('summaries.formChannel', { defaultValue: 'Channel' })}
                  </Label>
                  <Select
                    id="summary-channel"
                    value={runForm.channel}
                    onChange={(event) => {
                      if (isSummaryChannel(event.target.value)) {
                        updateRunForm('channel', event.target.value)
                      }
                    }}
                    options={SUMMARY_CHANNEL_OPTIONS}
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="summary-template-id">
                    {t('summaries.formTemplateId', { defaultValue: 'Template ID' })}
                  </Label>
                  <Input
                    id="summary-template-id"
                    value={runForm.templateId}
                    onChange={(event) => updateRunForm('templateId', event.target.value)}
                    placeholder="summary-daily"
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="summary-end-at">
                    {t('summaries.formEndAt', { defaultValue: 'Window end (ISO8601)' })}
                  </Label>
                  <Input
                    id="summary-end-at"
                    value={runForm.endAt}
                    onChange={(event) => updateRunForm('endAt', event.target.value)}
                    placeholder="2026-03-26T00:00:00Z"
                    disabled={submitting}
                  />
                </div>
              </div>

              {runForm.channel === 'email' ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="summary-to">
                      {t('summaries.formEmailTo', { defaultValue: 'Email recipient' })}
                    </Label>
                    <Input
                      id="summary-to"
                      value={runForm.to}
                      onChange={(event) => updateRunForm('to', event.target.value)}
                      placeholder="ops@example.com"
                      disabled={submitting}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="summary-subject">
                      {t('summaries.formSubject', { defaultValue: 'Subject override' })}
                    </Label>
                    <Input
                      id="summary-subject"
                      value={runForm.subject}
                      onChange={(event) => updateRunForm('subject', event.target.value)}
                      placeholder="Weekly Ops Summary dev"
                      disabled={submitting}
                    />
                  </div>
                </div>
              ) : null}

              {(runForm.channel === 'wechat_work' || runForm.channel === 'feishu') ? (
                <div className="space-y-2">
                  <Label htmlFor="summary-webhook-url">
                    {t('summaries.formWebhookUrl', { defaultValue: 'Webhook URL override' })}
                  </Label>
                  <Input
                    id="summary-webhook-url"
                    value={runForm.webhookUrl}
                    onChange={(event) => updateRunForm('webhookUrl', event.target.value)}
                    placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=***"
                    disabled={submitting}
                  />
                </div>
              ) : null}

              {runForm.channel === 'telegram' ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="summary-bot-token">
                      {t('summaries.formBotToken', { defaultValue: 'Telegram bot token override' })}
                    </Label>
                    <Input
                      id="summary-bot-token"
                      value={runForm.botToken}
                      onChange={(event) => updateRunForm('botToken', event.target.value)}
                      placeholder="123456:ABCDEF"
                      disabled={submitting}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="summary-chat-id">
                      {t('summaries.formChatId', { defaultValue: 'Telegram chat ID override' })}
                    </Label>
                    <Input
                      id="summary-chat-id"
                      value={runForm.chatId}
                      onChange={(event) => updateRunForm('chatId', event.target.value)}
                      placeholder="-1001234567890"
                      disabled={submitting}
                    />
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void handleRunAction('preview')
                  }}
                  disabled={submitting}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  {submittingPreview
                    ? t('summaries.previewSubmitting', { defaultValue: 'Previewing…' })
                    : t('summaries.previewAction', { defaultValue: 'Preview summary' })}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    void handleRunAction('send')
                  }}
                  disabled={submitting}
                >
                  <Send className="mr-2 h-4 w-4" />
                  {submittingSend
                    ? t('summaries.sendSubmitting', { defaultValue: 'Sending…' })
                    : t('summaries.sendAction', { defaultValue: 'Send summary' })}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('summaries.detailTitle', { defaultValue: 'Run detail' })}</CardTitle>
              <CardDescription>
                {t('summaries.detailDescription', {
                  defaultValue: 'Review the stored report window, delivery audit, and notes for the selected summary run.',
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {detailLoading ? (
                <div className="text-sm text-muted-foreground">{t('summaries.detailLoading', { defaultValue: 'Loading run detail…' })}</div>
              ) : !selectedRun ? (
                <div className="text-sm text-muted-foreground">{t('summaries.detailEmpty', { defaultValue: 'Select a run to inspect its detail.' })}</div>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailStatus', { defaultValue: 'Status' })}</div>
                      <div className="mt-1"><Badge variant={getRunStatusVariant(selectedRun.status)}>{selectedRun.status}</Badge></div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailPeriod', { defaultValue: 'Period' })}</div>
                      <div className="mt-1 text-sm">{formatPeriodLabel(selectedRun.period)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailWindow', { defaultValue: 'Window' })}</div>
                      <div className="mt-1 text-sm">{selectedRun.windowStart} → {selectedRun.windowEnd}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailStarted', { defaultValue: 'Started' })}</div>
                      <div className="mt-1 text-sm">{formatTimestamp(selectedRun.startedAt)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailFinished', { defaultValue: 'Finished' })}</div>
                      <div className="mt-1 text-sm">{formatTimestamp(selectedRun.finishedAt)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailTrigger', { defaultValue: 'Trigger' })}</div>
                      <div className="mt-1 text-sm">{selectedRun.triggerSource}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailDelivery', { defaultValue: 'Delivery' })}</div>
                      <div className="mt-1 text-sm">{selectedRunSummary}</div>
                    </div>
                    <div className="sm:col-span-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailComparison', { defaultValue: 'Comparison' })}</div>
                      <div className="mt-1 text-sm">{selectedRunComparisonSummary}</div>
                    </div>
                  </div>

                  {selectedRun.report.comparison ? (
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailComparisonWindow', { defaultValue: 'Previous period window' })}</div>
                      <div className="text-sm text-muted-foreground">
                        {selectedRun.report.comparison.previousWindow.startAt} → {selectedRun.report.comparison.previousWindow.endAt}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-md border p-3">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailComparisonShared', { defaultValue: 'Shared ingest deltas' })}</div>
                          <div className="mt-2 space-y-1 text-sm">
                            <div>{t('summaries.detailComparisonResumes', { defaultValue: 'New resumes' })}: {formatDelta(selectedRun.report.comparison.totalsDelta.sharedIngest.newResumes)}</div>
                            <div>{t('summaries.detailComparisonCompleted', { defaultValue: 'Completed tasks' })}: {formatDelta(selectedRun.report.comparison.totalsDelta.sharedIngest.collectionTasksCompleted)}</div>
                            <div>{t('summaries.detailComparisonFailed', { defaultValue: 'Failed tasks' })}: {formatDelta(selectedRun.report.comparison.totalsDelta.sharedIngest.collectionTasksFailed)}</div>
                          </div>
                        </div>
                        <div className="rounded-md border p-3">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailComparisonWorkspace', { defaultValue: 'Workspace activity deltas' })}</div>
                          <div className="mt-2 space-y-1 text-sm">
                            <div>{t('summaries.detailComparisonStatus', { defaultValue: 'Candidate status updates' })}: {formatDelta(selectedRun.report.comparison.totalsDelta.workspaceActivity.candidateStatusUpdates)}</div>
                            <div>{t('summaries.detailComparisonShortlist', { defaultValue: 'Shortlist actions' })}: {formatDelta(selectedRun.report.comparison.totalsDelta.workspaceActivity.shortlistActions)}</div>
                            <div>{t('summaries.detailComparisonReject', { defaultValue: 'Reject actions' })}: {formatDelta(selectedRun.report.comparison.totalsDelta.workspaceActivity.rejectActions)}</div>
                            <div>{t('summaries.detailComparisonContact', { defaultValue: 'Contact actions' })}: {formatDelta(selectedRun.report.comparison.totalsDelta.workspaceActivity.contactActions)}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {selectedRun.delivery?.accounts && selectedRun.delivery.accounts.length > 0 ? (
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailAccounts', { defaultValue: 'Telegram accounts' })}</div>
                      <div className="space-y-2">
                        {selectedRun.delivery.accounts.map((account) => (
                          <div key={`${account.index}-${account.chatIdHint}`} className="rounded-md border p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="font-medium">{account.chatIdHint}</div>
                              <Badge variant={account.sent ? 'default' : account.attempted ? 'destructive' : 'outline'}>
                                {formatAccountStatus(account)}
                              </Badge>
                            </div>
                            <div className="mt-2 text-sm text-muted-foreground">
                              {t('summaries.detailBatches', { defaultValue: 'Planned batches' })}: {account.batchesPlanned}
                            </div>
                            {account.skippedReason ? (
                              <div className="mt-1 text-sm text-muted-foreground">
                                {t('summaries.detailSkipReason', { defaultValue: 'Skip reason' })}: {account.skippedReason}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {selectedRun.report.notes.length > 0 ? (
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailNotes', { defaultValue: 'Notes' })}</div>
                      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                        {selectedRun.report.notes.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {selectedRun.content ? (
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailContent', { defaultValue: 'Rendered content' })}</div>
                      <pre className="max-h-[320px] overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap">{selectedRun.content}</pre>
                    </div>
                  ) : null}

                  {selectedRun.error ? (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                      {selectedRun.error}
                    </div>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
