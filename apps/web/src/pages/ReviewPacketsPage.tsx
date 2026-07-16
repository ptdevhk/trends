import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Download, FileUp, RefreshCw, Send, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import type { BadgeProps } from '@/components/ui/badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/PageHeader'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { apiBaseUrl } from '@/lib/api-client'
import type { components } from '@/lib/api-types'
import { rawApiClient } from '@/lib/api-helpers'
import { withWorkspaceHeaders } from '@/lib/workspace-ref'
import { reportUiError } from '@/lib/ui-error-reporting'

type ReviewPacketRun = components['schemas']['ReviewPacketRun']
type ReviewPacketRunStatus = components['schemas']['ReviewPacketRunStatus']
type ReviewPacketExportRequest = components['schemas']['ReviewPacketExportRequest']
type ReviewPacketRunsResponse = components['schemas']['ReviewPacketRunsResponse']
type ReviewPacketTrackedExportResponse = components['schemas']['ReviewPacketTrackedExportResponse']
type ReviewPacketFeedbackImportResponse = components['schemas']['ReviewPacketFeedbackImportResponse']
type ReviewPacketSummaryPreviewResponse = components['schemas']['ReviewPacketSummaryPreviewResponse']
type ReviewPacketSummarySendResponse = components['schemas']['ReviewPacketSummarySendResponse']
type ReviewPacketSource = components['schemas']['ResumeExportSource']
type ReviewPacketFormat = ReviewPacketExportRequest['format']

type ReviewPacketRunDetailResponse = {
  success: true
  run: ReviewPacketRun
}

const REVIEW_PACKET_LIST_LIMIT = 20
const DEFAULT_TEMPLATE_ID = 'review-packet-wechat'

function buildRunApiPath(runId: string, suffix?: string): string {
  const encodedRunId = encodeURIComponent(runId)
  return suffix
    ? `/api/resumes/review-packets/${encodedRunId}/${suffix}`
    : `/api/resumes/review-packets/${encodedRunId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function normalizeOptionalString(value: string): string | undefined {
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
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

function parseResumeIds(value: string): string[] {
  const tokens = value
    .split(/[\s,，、]+/g)
    .map((token) => token.trim())
    .filter(Boolean)

  return Array.from(new Set(tokens))
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

function parseDownloadFilename(contentDisposition: string | null): string | undefined {
  if (!contentDisposition) {
    return undefined
  }

  const encodedMatch = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)
  if (encodedMatch?.[1]) {
    const encodedFilename = encodedMatch[1].trim().replace(/^"(.*)"$/, '$1')
    try {
      return decodeURIComponent(encodedFilename)
    } catch {
      return encodedFilename
    }
  }

  const filenameMatch = contentDisposition.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i)
  const filename = filenameMatch?.[1] ?? filenameMatch?.[2]
  return filename?.trim()
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const blobUrl = window.URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = blobUrl
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)

  try {
    link.click()
  } finally {
    link.remove()
    window.URL.revokeObjectURL(blobUrl)
  }
}

async function readResponseError(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const payload: unknown = await response.json().catch(() => null)
    return extractApiErrorMessage(payload) ?? `Request failed (HTTP ${response.status})`
  }

  const responseText = await response.text().catch(() => '')
  return responseText.trim() || `Request failed (HTTP ${response.status})`
}

function isReviewPacketFeedbackImportResponse(value: unknown): value is ReviewPacketFeedbackImportResponse {
  return isRecord(value)
    && value.success === true
    && isRecord(value.run)
    && isRecord(value.summary)
    && Array.isArray(value.warnings)
}

function mergeRun(items: ReviewPacketRun[], nextRun: ReviewPacketRun): ReviewPacketRun[] {
  const existingIndex = items.findIndex((item) => item.id === nextRun.id)
  if (existingIndex < 0) {
    return [nextRun, ...items]
  }

  return items.map((item) => (item.id === nextRun.id ? nextRun : item))
}

function getStatusBadgeVariant(status: ReviewPacketRunStatus): BadgeProps['variant'] {
  if (status === 'failed') {
    return 'destructive'
  }
  if (status === 'summary_sent') {
    return 'default'
  }
  if (status === 'feedback_imported') {
    return 'secondary'
  }
  return 'outline'
}

function getStatusLabel(status: ReviewPacketRunStatus): string {
  return status.replace(/_/g, ' ')
}

function getSourceLabel(source: ReviewPacketSource): string {
  return source === 'convex' ? 'Convex' : 'Sample'
}

function isReviewPacketSource(value: string): value is ReviewPacketSource {
  return value === 'convex' || value === 'sample'
}

function isReviewPacketFormat(value: string): value is ReviewPacketFormat {
  return value === 'csv' || value === 'xlsx'
}

export function ReviewPacketsPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const feedbackFileInputRef = useRef<HTMLInputElement | null>(null)
  const selectedRunIdRef = useRef<string | null>(null)

  const [runs, setRuns] = useState<ReviewPacketRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedRun, setSelectedRun] = useState<ReviewPacketRun | null>(null)
  const [summaryPreview, setSummaryPreview] = useState<ReviewPacketSummaryPreviewResponse | null>(null)

  const [runsLoading, setRunsLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [downloadingRunId, setDownloadingRunId] = useState<string | null>(null)
  const [feedbackImporting, setFeedbackImporting] = useState(false)
  const [summaryPreviewing, setSummaryPreviewing] = useState(false)
  const [summarySending, setSummarySending] = useState(false)

  const [source, setSource] = useState<ReviewPacketSource>('convex')
  const [format, setFormat] = useState<ReviewPacketFormat>('xlsx')
  const [sampleName, setSampleName] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [jobDescriptionId, setJobDescriptionId] = useState('')
  const [resumeIdsText, setResumeIdsText] = useState('')
  const [userComment, setUserComment] = useState('')
  const [referenceNote, setReferenceNote] = useState('')
  const [feedbackFile, setFeedbackFile] = useState<File | null>(null)
  const [feedbackUpdatedBy, setFeedbackUpdatedBy] = useState('')
  const [summaryTemplateId, setSummaryTemplateId] = useState(DEFAULT_TEMPLATE_ID)
  const [summaryWebhookUrl, setSummaryWebhookUrl] = useState('')

  useEffect(() => {
    const sourceParam = searchParams.get('source')
    if (sourceParam && isReviewPacketSource(sourceParam)) {
      setSource(sourceParam)
    }

    const formatParam = searchParams.get('format')
    if (formatParam && isReviewPacketFormat(formatParam)) {
      setFormat(formatParam)
    }

    setSampleName(searchParams.get('sample') ?? '')
    setSessionId(searchParams.get('sessionId') ?? '')
    setJobDescriptionId(searchParams.get('jobDescriptionId') ?? '')
    setUserComment(searchParams.get('userComment') ?? '')
    setReferenceNote(searchParams.get('referenceNote') ?? '')

    const resumeIdsParam = searchParams.get('resumeIds')
    setResumeIdsText(resumeIdsParam ? parseResumeIds(resumeIdsParam).join('\n') : '')
  }, [searchParams])

  const loadRuns = useCallback(async (preferredRunId?: string) => {
    setRunsLoading(true)
    try {
      const { data, error } = await rawApiClient.GET<ReviewPacketRunsResponse>('/api/resumes/review-packets', {
        params: {
          query: {
            limit: REVIEW_PACKET_LIST_LIMIT,
          },
        },
      })

      if (error || !data?.success) {
        throw new Error(
          extractApiErrorMessage(error) ?? t('reviewPackets.loadRunsError', { defaultValue: 'Failed to load review packet runs' }),
        )
      }

      const items = data.items ?? []
      setRuns(items)

      const preferredSelection = preferredRunId && items.some((item) => item.id === preferredRunId)
        ? preferredRunId
        : null
      const existingSelection = selectedRunIdRef.current && items.some((item) => item.id === selectedRunIdRef.current)
        ? selectedRunIdRef.current
        : null
      const nextSelection = preferredSelection ?? existingSelection ?? items[0]?.id ?? null

      selectedRunIdRef.current = nextSelection
      setSelectedRunId(nextSelection)
      if (!nextSelection) {
        setSelectedRun(null)
        setSummaryPreview(null)
      }
    } catch (error) {
      reportUiError('Failed to load review packet runs', error)
      const message = error instanceof Error && error.message.trim().length > 0
        ? error.message
        : t('reviewPackets.loadRunsError', { defaultValue: 'Failed to load review packet runs' })
      toast.error(message)
    } finally {
      setRunsLoading(false)
    }
  }, [t])

  const loadRunDetail = useCallback(async (runId: string) => {
    setDetailLoading(true)
    try {
      const { data, error } = await rawApiClient.GET<ReviewPacketRunDetailResponse>(
        buildRunApiPath(runId),
      )

      if (error || !data?.success) {
        throw new Error(
          extractApiErrorMessage(error) ?? t('reviewPackets.loadRunError', { defaultValue: 'Failed to load review packet run' }),
        )
      }

      setSelectedRun(data.run)
      setRuns((current) => mergeRun(current, data.run))
    } catch (error) {
      reportUiError(`Failed to load review packet run ${runId}`, error)
      const message = error instanceof Error && error.message.trim().length > 0
        ? error.message
        : t('reviewPackets.loadRunError', { defaultValue: 'Failed to load review packet run' })
      toast.error(message)
    } finally {
      setDetailLoading(false)
    }
  }, [t])

  function updateRunState(nextRun: ReviewPacketRun) {
    setSelectedRunId(nextRun.id)
    setSelectedRun(nextRun)
    setRuns((current) => mergeRun(current, nextRun))
  }

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId
  }, [selectedRunId])

  useEffect(() => {
    void loadRuns()
  }, [loadRuns])

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRun(null)
      setSummaryPreview(null)
      return
    }

    setSummaryPreview((current) => (current?.run.id === selectedRunId ? current : null))
    void loadRunDetail(selectedRunId)
  }, [loadRunDetail, selectedRunId])

  async function handleExportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const resumeIds = parseResumeIds(resumeIdsText)
    if (resumeIds.length === 0) {
      toast.error(t('reviewPackets.resumeIdsRequired', { defaultValue: 'Enter at least one resume ID' }))
      return
    }

    if (resumeIds.length > 2000) {
      toast.error(t('reviewPackets.resumeIdsLimit', { defaultValue: 'Review packets support at most 2000 resume IDs per export' }))
      return
    }

    if (source === 'sample' && !normalizeOptionalString(sampleName)) {
      toast.error(t('reviewPackets.sampleRequired', { defaultValue: 'Sample name is required when source is sample' }))
      return
    }

    const payload: ReviewPacketExportRequest = {
      format,
      source,
      entries: resumeIds.map((resumeId) => ({ resumeId })),
    }

    const normalizedSampleName = normalizeOptionalString(sampleName)
    const normalizedSessionId = normalizeOptionalString(sessionId)
    const normalizedJobDescriptionId = normalizeOptionalString(jobDescriptionId)
    const normalizedUserComment = normalizeOptionalString(userComment)
    const normalizedReferenceNote = normalizeOptionalString(referenceNote)

    if (normalizedSampleName) {
      payload.sample = normalizedSampleName
    }
    if (normalizedSessionId) {
      payload.sessionId = normalizedSessionId
    }
    if (normalizedJobDescriptionId) {
      payload.jobDescriptionId = normalizedJobDescriptionId
    }
    if (normalizedUserComment) {
      payload.userComment = normalizedUserComment
    }
    if (normalizedReferenceNote) {
      payload.referenceNote = normalizedReferenceNote
    }

    setExporting(true)
    try {
      const { data, error } = await rawApiClient.POST<ReviewPacketTrackedExportResponse>(
        '/api/resumes/review-packets/export',
        {
          body: payload,
        },
      )

      if (error || !data?.success) {
        throw new Error(
          extractApiErrorMessage(error) ?? t('reviewPackets.exportError', { defaultValue: 'Failed to create review packet export' }),
        )
      }

      updateRunState(data.run)
      setSummaryPreview(null)
      toast.success(t('reviewPackets.exportSuccess', { defaultValue: 'Review packet exported' }))
      await loadRuns(data.run.id)
    } catch (error) {
      reportUiError('Failed to export review packet', error)
      const message = error instanceof Error && error.message.trim().length > 0
        ? error.message
        : t('reviewPackets.exportError', { defaultValue: 'Failed to create review packet export' })
      toast.error(message)
    } finally {
      setExporting(false)
    }
  }

  async function handleDownload(run: ReviewPacketRun) {
    setDownloadingRunId(run.id)
    try {
      const downloadUrl = new URL(
        `${apiBaseUrl}/api/resumes/review-packets/${encodeURIComponent(run.id)}/download`,
        window.location.origin,
      ).toString()

      const response = await fetch(downloadUrl, {
        headers: withWorkspaceHeaders(),
      })

      if (!response.ok) {
        throw new Error(await readResponseError(response))
      }

      const blob = await response.blob()
      const filename = parseDownloadFilename(response.headers.get('content-disposition'))
        ?? run.packetFilename
        ?? `review-packet-${run.id}.${run.format}`
      triggerBlobDownload(blob, filename)
    } catch (error) {
      reportUiError(`Failed to download review packet ${run.id}`, error)
      const message = error instanceof Error && error.message.trim().length > 0
        ? error.message
        : t('reviewPackets.downloadError', { defaultValue: 'Failed to download review packet' })
      toast.error(message)
    } finally {
      setDownloadingRunId(null)
    }
  }

  async function handleFeedbackImport() {
    if (!selectedRun) {
      return
    }

    if (!feedbackFile) {
      toast.error(t('reviewPackets.feedbackFileRequired', { defaultValue: 'Choose a reviewed CSV or XLSX file to import' }))
      return
    }

    setFeedbackImporting(true)
    try {
      const formData = new FormData()
      formData.append('file', feedbackFile)

      const normalizedUpdatedBy = normalizeOptionalString(feedbackUpdatedBy)
      if (normalizedUpdatedBy) {
        formData.append('updatedBy', normalizedUpdatedBy)
      }

      const response = await fetch(
        new URL(
          `${apiBaseUrl}/api/resumes/review-packets/${encodeURIComponent(selectedRun.id)}/feedback-import`,
          window.location.origin,
        ).toString(),
        {
          method: 'POST',
          headers: withWorkspaceHeaders(),
          body: formData,
        },
      )

      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(payload) ?? `Import failed (HTTP ${response.status})`)
      }

      if (!isReviewPacketFeedbackImportResponse(payload)) {
        throw new Error(
          t('reviewPackets.feedbackImportInvalidResponse', { defaultValue: 'Received an invalid review packet import response' }),
        )
      }

      updateRunState(payload.run)
      setFeedbackFile(null)
      if (feedbackFileInputRef.current) {
        feedbackFileInputRef.current.value = ''
      }
      setSummaryPreview(null)
      toast.success(
        t('reviewPackets.feedbackImportSuccess', {
          defaultValue: 'Imported {{count}} reviewed rows',
          count: payload.summary.importedRows,
        }),
      )
    } catch (error) {
      reportUiError(`Failed to import feedback for review packet ${selectedRun.id}`, error)
      const message = error instanceof Error && error.message.trim().length > 0
        ? error.message
        : t('reviewPackets.feedbackImportError', { defaultValue: 'Failed to import review packet feedback' })
      toast.error(message)
    } finally {
      setFeedbackImporting(false)
    }
  }

  async function handlePreviewSummary() {
    if (!selectedRun) {
      return
    }

    setSummaryPreviewing(true)
    try {
      const body: { templateId?: string } = {}
      const normalizedTemplateId = normalizeOptionalString(summaryTemplateId)
      if (normalizedTemplateId) {
        body.templateId = normalizedTemplateId
      }

      const { data, error } = await rawApiClient.POST<ReviewPacketSummaryPreviewResponse>(
        buildRunApiPath(selectedRun.id, 'summary-preview'),
        {
          body,
        },
      )

      if (error || !data?.success) {
        throw new Error(
          extractApiErrorMessage(error) ?? t('reviewPackets.summaryPreviewError', { defaultValue: 'Failed to preview summary' }),
        )
      }

      updateRunState(data.run)
      setSummaryPreview(data)
      toast.success(t('reviewPackets.summaryPreviewSuccess', { defaultValue: 'Summary preview generated' }))
    } catch (error) {
      reportUiError(`Failed to preview summary for review packet ${selectedRun.id}`, error)
      const message = error instanceof Error && error.message.trim().length > 0
        ? error.message
        : t('reviewPackets.summaryPreviewError', { defaultValue: 'Failed to preview summary' })
      toast.error(message)
    } finally {
      setSummaryPreviewing(false)
    }
  }

  async function handleSendSummary() {
    if (!selectedRun) {
      return
    }

    setSummarySending(true)
    try {
      const body: { templateId?: string; webhookUrl?: string } = {}
      const normalizedTemplateId = normalizeOptionalString(summaryTemplateId)
      const normalizedWebhookUrl = normalizeOptionalString(summaryWebhookUrl)
      if (normalizedTemplateId) {
        body.templateId = normalizedTemplateId
      }
      if (normalizedWebhookUrl) {
        body.webhookUrl = normalizedWebhookUrl
      }

      const { data, error } = await rawApiClient.POST<ReviewPacketSummarySendResponse>(
        buildRunApiPath(selectedRun.id, 'summary-send'),
        {
          body,
        },
      )

      if (error || !data?.success) {
        throw new Error(
          extractApiErrorMessage(error) ?? t('reviewPackets.summarySendError', { defaultValue: 'Failed to send summary' }),
        )
      }

      updateRunState(data.run)
      toast.success(t('reviewPackets.summarySendSuccess', { defaultValue: 'Summary sent' }))
    } catch (error) {
      reportUiError(`Failed to send summary for review packet ${selectedRun.id}`, error)
      const message = error instanceof Error && error.message.trim().length > 0
        ? error.message
        : t('reviewPackets.summarySendError', { defaultValue: 'Failed to send summary' })
      toast.error(message)
    } finally {
      setSummarySending(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('reviewPackets.title', { defaultValue: 'Review packets' })}
        description={t('reviewPackets.description', {
          defaultValue: 'Create a tracked CSV/XLSX packet from resume IDs, then import reviewer feedback and send the WeChat summary from the same workspace page.',
        })}
        actions={(
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void loadRuns()
            }}
            disabled={runsLoading}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('reviewPackets.refresh', { defaultValue: 'Refresh' })}
          </Button>
        )}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">
              {t('reviewPackets.exportCardTitle', { defaultValue: 'Create export run' })}
            </CardTitle>
            <CardDescription>
              {t('reviewPackets.exportCardDescription', {
                defaultValue: 'Thin v1 workflow: paste resume IDs, choose the source, and create a tracked packet without going through the resumes page.',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={(event) => { void handleExportSubmit(event) }}>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="review-packets-source">
                    {t('reviewPackets.source', { defaultValue: 'Source' })}
                  </Label>
                  <Select
                    id="review-packets-source"
                    value={source}
                    onChange={(event) => {
                      if (isReviewPacketSource(event.target.value)) {
                        setSource(event.target.value)
                      }
                    }}
                    options={[
                      { value: 'convex', label: t('reviewPackets.sourceConvex', { defaultValue: 'Convex' }) },
                      { value: 'sample', label: t('reviewPackets.sourceSample', { defaultValue: 'Sample' }) },
                    ]}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="review-packets-format">
                    {t('reviewPackets.format', { defaultValue: 'Format' })}
                  </Label>
                  <Select
                    id="review-packets-format"
                    value={format}
                    onChange={(event) => {
                      if (isReviewPacketFormat(event.target.value)) {
                        setFormat(event.target.value)
                      }
                    }}
                    options={[
                      { value: 'xlsx', label: 'XLSX' },
                      { value: 'csv', label: 'CSV' },
                    ]}
                  />
                </div>
              </div>

              {source === 'sample' ? (
                <div className="space-y-2">
                  <Label htmlFor="review-packets-sample">
                    {t('reviewPackets.sampleName', { defaultValue: 'Sample name' })}
                  </Label>
                  <Input
                    id="review-packets-sample"
                    value={sampleName}
                    onChange={(event) => setSampleName(event.target.value)}
                    placeholder={t('reviewPackets.samplePlaceholder', { defaultValue: 'sample-initial' })}
                  />
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="review-packets-session-id">
                    {t('reviewPackets.sessionId', { defaultValue: 'Session ID' })}
                  </Label>
                  <Input
                    id="review-packets-session-id"
                    value={sessionId}
                    onChange={(event) => setSessionId(event.target.value)}
                    placeholder={t('reviewPackets.sessionIdPlaceholder', { defaultValue: 'session-123' })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="review-packets-job-description-id">
                    {t('reviewPackets.jobDescriptionId', { defaultValue: 'Job description ID' })}
                  </Label>
                  <Input
                    id="review-packets-job-description-id"
                    value={jobDescriptionId}
                    onChange={(event) => setJobDescriptionId(event.target.value)}
                    placeholder={t('reviewPackets.jobDescriptionIdPlaceholder', { defaultValue: 'lathe-sales' })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="review-packets-resume-ids">
                  {t('reviewPackets.resumeIds', { defaultValue: 'Resume IDs' })}
                </Label>
                <Textarea
                  id="review-packets-resume-ids"
                  value={resumeIdsText}
                  onChange={(event) => setResumeIdsText(event.target.value)}
                  placeholder={t('reviewPackets.resumeIdsPlaceholder', {
                    defaultValue: 'resume-1\nresume-2\nresume-3',
                  })}
                  className="min-h-[150px]"
                />
                <p className="text-xs text-muted-foreground">
                  {t('reviewPackets.resumeIdsHint', {
                    defaultValue: 'Comma, space, and newline separators are all supported.',
                  })}
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="review-packets-user-comment">
                    {t('reviewPackets.userComment', { defaultValue: 'User Comment' })}
                  </Label>
                  <Textarea
                    id="review-packets-user-comment"
                    value={userComment}
                    onChange={(event) => setUserComment(event.target.value)}
                    placeholder={t('reviewPackets.userCommentPlaceholder', { defaultValue: 'Batch note for reviewers' })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="review-packets-reference-note">
                    {t('reviewPackets.referenceNote', { defaultValue: 'Reference note' })}
                  </Label>
                  <Textarea
                    id="review-packets-reference-note"
                    value={referenceNote}
                    onChange={(event) => setReferenceNote(event.target.value)}
                    placeholder={t('reviewPackets.referenceNotePlaceholder', { defaultValue: 'Internal handoff note' })}
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button type="submit" disabled={exporting}>
                  {exporting
                    ? t('reviewPackets.exporting', { defaultValue: 'Creating…' })
                    : t('reviewPackets.exportSubmit', { defaultValue: 'Create packet' })}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">
              {t('reviewPackets.runsCardTitle', { defaultValue: 'Recent runs' })}
            </CardTitle>
            <CardDescription>
              {t('reviewPackets.runsCardDescription', {
                defaultValue: 'Track the latest export runs and open one to handle download, feedback import, and summary send.',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {runsLoading ? (
              <p className="text-sm text-muted-foreground">
                {t('reviewPackets.loadingRuns', { defaultValue: 'Loading review packet runs…' })}
              </p>
            ) : runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('reviewPackets.noRuns', { defaultValue: 'No tracked review packet runs yet.' })}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('reviewPackets.runId', { defaultValue: 'Run' })}</TableHead>
                    <TableHead>{t('reviewPackets.status', { defaultValue: 'Status' })}</TableHead>
                    <TableHead>{t('reviewPackets.total', { defaultValue: 'Total' })}</TableHead>
                    <TableHead>{t('reviewPackets.source', { defaultValue: 'Source' })}</TableHead>
                    <TableHead>{t('reviewPackets.exportedAt', { defaultValue: 'Exported' })}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>
                        <Button
                          type="button"
                          variant={selectedRunId === run.id ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => setSelectedRunId(run.id)}
                        >
                          {run.id}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(run.status)}>
                          {getStatusLabel(run.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>{run.totalCount}</TableCell>
                      <TableCell>{getSourceLabel(run.source)}</TableCell>
                      <TableCell>{formatTimestamp(run.exportedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            {t('reviewPackets.detailCardTitle', { defaultValue: 'Selected run' })}
          </CardTitle>
          <CardDescription>
            {selectedRun
              ? t('reviewPackets.detailCardDescription', {
                defaultValue: 'Operate on the tracked packet file, import reviewed feedback, and generate the WeChat summary for this run.',
              })
              : t('reviewPackets.detailCardEmpty', {
                defaultValue: 'Choose a run from the list to inspect its tracked state.',
              })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {detailLoading && !selectedRun ? (
            <p className="text-sm text-muted-foreground">
              {t('reviewPackets.loadingRun', { defaultValue: 'Loading run details…' })}
            </p>
          ) : !selectedRun ? (
            <p className="text-sm text-muted-foreground">
              {t('reviewPackets.noSelectedRun', { defaultValue: 'No review packet run selected.' })}
            </p>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border bg-muted/20 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t('reviewPackets.selectedRun', { defaultValue: 'Run ID' })}
                  </p>
                  <p className="mt-2 font-medium">{selectedRun.id}</p>
                </div>
                <div className="rounded-lg border bg-muted/20 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t('reviewPackets.status', { defaultValue: 'Status' })}
                  </p>
                  <div className="mt-2">
                    <Badge variant={getStatusBadgeVariant(selectedRun.status)}>
                      {getStatusLabel(selectedRun.status)}
                    </Badge>
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/20 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t('reviewPackets.source', { defaultValue: 'Source' })}
                  </p>
                  <p className="mt-2 font-medium">{getSourceLabel(selectedRun.source)}</p>
                </div>
                <div className="rounded-lg border bg-muted/20 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t('reviewPackets.total', { defaultValue: 'Total resumes' })}
                  </p>
                  <p className="mt-2 font-medium">{selectedRun.totalCount}</p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t('reviewPackets.exportedAt', { defaultValue: 'Exported at' })}
                  </p>
                  <p className="mt-2 text-sm">{formatTimestamp(selectedRun.exportedAt)}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t('reviewPackets.feedbackImportedAt', { defaultValue: 'Feedback imported' })}
                  </p>
                  <p className="mt-2 text-sm">{formatTimestamp(selectedRun.feedbackImportedAt)}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t('reviewPackets.summarySentAt', { defaultValue: 'Summary sent' })}
                  </p>
                  <p className="mt-2 text-sm">{formatTimestamp(selectedRun.summarySentAt)}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t('reviewPackets.packetFilename', { defaultValue: 'Packet file' })}
                  </p>
                  <p className="mt-2 text-sm break-all">{selectedRun.packetFilename || '—'}</p>
                </div>
              </div>

              {selectedRun.error ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                  <p className="font-medium">
                    {t('reviewPackets.runError', { defaultValue: 'Run error' })}
                  </p>
                  <p className="mt-1">{selectedRun.error}</p>
                </div>
              ) : null}

              <div className="grid gap-6 xl:grid-cols-3">
                <Card className="border-dashed shadow-none">
                  <CardHeader>
                    <CardTitle className="text-lg">
                      {t('reviewPackets.downloadCardTitle', { defaultValue: 'Download packet' })}
                    </CardTitle>
                    <CardDescription>
                      {t('reviewPackets.downloadCardDescription', {
                        defaultValue: 'Fetch the stored CSV/XLSX packet using the workspace-aware download route.',
                      })}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        void handleDownload(selectedRun)
                      }}
                      disabled={downloadingRunId === selectedRun.id}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      {downloadingRunId === selectedRun.id
                        ? t('reviewPackets.downloading', { defaultValue: 'Downloading…' })
                        : t('reviewPackets.downloadSubmit', { defaultValue: 'Download packet' })}
                    </Button>
                  </CardContent>
                </Card>

                <Card className="border-dashed shadow-none">
                  <CardHeader>
                    <CardTitle className="text-lg">
                      {t('reviewPackets.feedbackCardTitle', { defaultValue: 'Import feedback' })}
                    </CardTitle>
                    <CardDescription>
                      {t('reviewPackets.feedbackCardDescription', {
                        defaultValue: 'Upload the reviewed spreadsheet to update statuses, actions, and notes on the tracked run.',
                      })}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="review-packets-feedback-file">
                        {t('reviewPackets.feedbackFile', { defaultValue: 'Reviewed file' })}
                      </Label>
                      <Input
                        ref={feedbackFileInputRef}
                        id="review-packets-feedback-file"
                        type="file"
                        accept=".csv,.xlsx"
                        onChange={(event) => setFeedbackFile(event.target.files?.[0] ?? null)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="review-packets-feedback-updated-by">
                        {t('reviewPackets.updatedBy', { defaultValue: 'Updated by' })}
                      </Label>
                      <Input
                        id="review-packets-feedback-updated-by"
                        value={feedbackUpdatedBy}
                        onChange={(event) => setFeedbackUpdatedBy(event.target.value)}
                        placeholder={t('reviewPackets.updatedByPlaceholder', { defaultValue: 'hr.lead' })}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        void handleFeedbackImport()
                      }}
                      disabled={feedbackImporting}
                    >
                      <FileUp className="mr-2 h-4 w-4" />
                      {feedbackImporting
                        ? t('reviewPackets.feedbackImporting', { defaultValue: 'Importing…' })
                        : t('reviewPackets.feedbackSubmit', { defaultValue: 'Import feedback' })}
                    </Button>
                  </CardContent>
                </Card>

                <Card className="border-dashed shadow-none">
                  <CardHeader>
                    <CardTitle className="text-lg">
                      {t('reviewPackets.summaryCardTitle', { defaultValue: 'Preview and send summary' })}
                    </CardTitle>
                    <CardDescription>
                      {t('reviewPackets.summaryCardDescription', {
                        defaultValue: 'Generate the WeChat summary preview, then send it with the configured template and optional webhook override.',
                      })}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="review-packets-template-id">
                        {t('reviewPackets.templateId', { defaultValue: 'Template ID' })}
                      </Label>
                      <Input
                        id="review-packets-template-id"
                        value={summaryTemplateId}
                        onChange={(event) => setSummaryTemplateId(event.target.value)}
                        placeholder={DEFAULT_TEMPLATE_ID}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="review-packets-webhook-url">
                        {t('reviewPackets.webhookUrl', { defaultValue: 'Webhook URL' })}
                      </Label>
                      <Input
                        id="review-packets-webhook-url"
                        value={summaryWebhookUrl}
                        onChange={(event) => setSummaryWebhookUrl(event.target.value)}
                        placeholder={t('reviewPackets.webhookUrlPlaceholder', {
                          defaultValue: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=***',
                        })}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          void handlePreviewSummary()
                        }}
                        disabled={summaryPreviewing}
                      >
                        <Sparkles className="mr-2 h-4 w-4" />
                        {summaryPreviewing
                          ? t('reviewPackets.summaryPreviewing', { defaultValue: 'Previewing…' })
                          : t('reviewPackets.summaryPreviewSubmit', { defaultValue: 'Preview summary' })}
                      </Button>
                      <Button
                        type="button"
                        onClick={() => {
                          void handleSendSummary()
                        }}
                        disabled={summarySending}
                      >
                        <Send className="mr-2 h-4 w-4" />
                        {summarySending
                          ? t('reviewPackets.summarySending', { defaultValue: 'Sending…' })
                          : t('reviewPackets.summarySendSubmit', { defaultValue: 'Send summary' })}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {selectedRun.stats?.import ? (
                <div className="rounded-lg border bg-muted/10 p-4">
                  <h2 className="text-sm font-semibold">
                    {t('reviewPackets.importStatsTitle', { defaultValue: 'Latest feedback import' })}
                  </h2>
                  <div className="mt-3 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {t('reviewPackets.totalRows', { defaultValue: 'Total rows' })}
                      </p>
                      <p className="mt-1 font-medium">{selectedRun.stats.import.totalRows}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {t('reviewPackets.importedRows', { defaultValue: 'Imported' })}
                      </p>
                      <p className="mt-1 font-medium">{selectedRun.stats.import.importedRows}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {t('reviewPackets.reviewedCount', { defaultValue: 'Reviewed' })}
                      </p>
                      <p className="mt-1 font-medium">{selectedRun.stats.import.reviewedCount}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {t('reviewPackets.statusUpdates', { defaultValue: 'Status updates' })}
                      </p>
                      <p className="mt-1 font-medium">{selectedRun.stats.import.statusUpdates}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {t('reviewPackets.actionUpdates', { defaultValue: 'Action updates' })}
                      </p>
                      <p className="mt-1 font-medium">{selectedRun.stats.import.actionUpdates}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {t('reviewPackets.warningCount', { defaultValue: 'Warnings' })}
                      </p>
                      <p className="mt-1 font-medium">{selectedRun.stats.import.warningCount}</p>
                    </div>
                  </div>
                  {selectedRun.stats.import.warnings.length > 0 ? (
                    <div className="mt-4 space-y-2">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        {t('reviewPackets.importWarnings', { defaultValue: 'Import warnings' })}
                      </p>
                      <ul className="space-y-1 text-sm text-muted-foreground">
                        {selectedRun.stats.import.warnings.map((warning, index) => (
                          <li key={`${warning}-${index}`}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {summaryPreview ? (
                <div className="space-y-4 rounded-lg border bg-muted/10 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-sm font-semibold">
                      {t('reviewPackets.summaryPreviewTitle', { defaultValue: 'Summary preview' })}
                    </h2>
                    <Badge variant="outline">{summaryPreview.channel}</Badge>
                    <Badge variant="outline">{summaryPreview.templateId}</Badge>
                  </div>
                  <Textarea value={summaryPreview.content} readOnly className="min-h-[240px]" />
                  <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {t('reviewPackets.totalExported', { defaultValue: 'Exported' })}
                      </p>
                      <p className="mt-1 font-medium">{summaryPreview.data.totalExported}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {t('reviewPackets.reviewedCount', { defaultValue: 'Reviewed' })}
                      </p>
                      <p className="mt-1 font-medium">{summaryPreview.data.reviewedCount}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {t('reviewPackets.pendingCount', { defaultValue: 'Pending' })}
                      </p>
                      <p className="mt-1 font-medium">{summaryPreview.data.pendingCount}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {t('reviewPackets.warningCount', { defaultValue: 'Warnings' })}
                      </p>
                      <p className="mt-1 font-medium">{summaryPreview.data.warningCount}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {t('reviewPackets.summaryChannel', { defaultValue: 'Channel' })}
                      </p>
                      <p className="mt-1 font-medium">{summaryPreview.channel}</p>
                    </div>
                  </div>
                  {summaryPreview.data.warnings.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        {t('reviewPackets.summaryWarnings', { defaultValue: 'Summary warnings' })}
                      </p>
                      <ul className="space-y-1 text-sm text-muted-foreground">
                        {summaryPreview.data.warnings.map((warning, index) => (
                          <li key={`${warning}-${index}`}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
