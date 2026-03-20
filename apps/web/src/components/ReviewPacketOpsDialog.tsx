import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RefreshCw, Send, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { rawApiClient } from '@/lib/api-helpers'
import { apiBaseUrl } from '@/lib/api-client'
import type { components } from '@/lib/api-types'
import { withWorkspaceHeaders } from '@/lib/workspace-ref'

type ReviewPacketRun = components['schemas']['ReviewPacketRun']
type ReviewPacketRunsResponse = components['schemas']['ReviewPacketRunsResponse']
type ReviewPacketFeedbackImportResponse = components['schemas']['ReviewPacketFeedbackImportResponse']
type ReviewPacketSummaryPreviewResponse = components['schemas']['ReviewPacketSummaryPreviewResponse']
type ReviewPacketSummarySendResponse = components['schemas']['ReviewPacketSummarySendResponse']

type ReviewPacketOpsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialRunId?: string
  onImported?: () => void | Promise<void>
}

function formatRunLabel(run: ReviewPacketRun): string {
  return `${run.id} · ${run.exportedAt} · ${run.totalCount}`
}

function buildReviewPacketImportUrl(runId: string): string {
  return new URL(`${apiBaseUrl}/api/resumes/review-packets/${runId}/feedback-import`, window.location.origin).toString()
}

export function ReviewPacketOpsDialog({
  open,
  onOpenChange,
  initialRunId,
  onImported,
}: ReviewPacketOpsDialogProps) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [runs, setRuns] = useState<ReviewPacketRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string>('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [previewContent, setPreviewContent] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [importing, setImporting] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [sending, setSending] = useState(false)

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId]
  )

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true)
    try {
      const response = await rawApiClient.GET<ReviewPacketRunsResponse>('/api/resumes/review-packets', {
        params: {
          query: {
            limit: 20,
          },
        },
      })
      const items = response.data?.items ?? []
      setRuns(items)
      setSelectedRunId((current) => {
        if (current && items.some((item) => item.id === current)) {
          return current
        }
        if (initialRunId && items.some((item) => item.id === initialRunId)) {
          return initialRunId
        }
        return items[0]?.id ?? ''
      })
    } catch (error) {
      console.error('Failed to load review packet runs', error)
      toast.error(t('reviewPackets.loadFailed', 'Failed to load review packet runs'))
    } finally {
      setLoadingRuns(false)
    }
  }, [initialRunId, t])

  useEffect(() => {
    if (!open) {
      setSelectedFile(null)
      setPreviewContent('')
      setWarnings([])
      return
    }

    void loadRuns()
  }, [loadRuns, open])

  const handleImport = async () => {
    if (!selectedRunId) {
      toast.error(t('reviewPackets.selectRunFirst', 'Select a review packet run first'))
      return
    }
    if (!selectedFile) {
      toast.error(t('reviewPackets.selectFileFirst', 'Select a CSV or XLSX file first'))
      return
    }

    setImporting(true)
    setWarnings([])

    try {
      const formData = new FormData()
      formData.append('file', selectedFile)
      const response = await fetch(buildReviewPacketImportUrl(selectedRunId), {
        method: 'POST',
        headers: withWorkspaceHeaders(),
        body: formData,
      })
      const payload = await response.json() as ReviewPacketFeedbackImportResponse | { error?: string }
      if (!response.ok || !('success' in payload) || payload.success !== true) {
        const message = 'error' in payload && typeof payload.error === 'string'
          ? payload.error
          : t('reviewPackets.importFailed', 'Failed to import review feedback')
        throw new Error(message)
      }

      setWarnings(payload.warnings)
      setRuns((current) => current.map((run) => run.id === payload.run.id ? payload.run : run))
      toast.success(t(
        'reviewPackets.importComplete',
        {
          count: payload.summary.importedRows,
          defaultValue: `Imported feedback for ${payload.summary.importedRows} rows`,
        }
      ))
      await onImported?.()
    } catch (error) {
      console.error('Failed to import review packet feedback', error)
      toast.error(
        error instanceof Error
          ? error.message
          : t('reviewPackets.importFailed', 'Failed to import review feedback')
      )
    } finally {
      setImporting(false)
    }
  }

  const handlePreview = async () => {
    if (!selectedRunId) {
      toast.error(t('reviewPackets.selectRunFirst', 'Select a review packet run first'))
      return
    }

    setPreviewing(true)
    try {
      const response = await rawApiClient.POST<ReviewPacketSummaryPreviewResponse>(
        `/api/resumes/review-packets/${selectedRunId}/summary-preview`,
        {
          body: {},
        }
      )
      const payload = response.data
      if (!payload?.success) {
        throw new Error(t('reviewPackets.previewFailed', 'Failed to preview review packet summary'))
      }

      setPreviewContent(payload.content)
      setRuns((current) => current.map((run) => run.id === payload.run.id ? payload.run : run))
      setWarnings(payload.data.warnings)
    } catch (error) {
      console.error('Failed to preview review packet summary', error)
      toast.error(
        error instanceof Error
          ? error.message
          : t('reviewPackets.previewFailed', 'Failed to preview review packet summary')
      )
    } finally {
      setPreviewing(false)
    }
  }

  const handleSend = async () => {
    if (!selectedRunId) {
      toast.error(t('reviewPackets.selectRunFirst', 'Select a review packet run first'))
      return
    }

    setSending(true)
    try {
      const response = await rawApiClient.POST<ReviewPacketSummarySendResponse>(
        `/api/resumes/review-packets/${selectedRunId}/summary-send`,
        {
          body: webhookUrl.trim() ? { webhookUrl: webhookUrl.trim() } : {},
        }
      )
      const payload = response.data
      if (!payload?.success) {
        throw new Error(t('reviewPackets.sendFailed', 'Failed to send review packet summary'))
      }

      setRuns((current) => current.map((run) => run.id === payload.run.id ? payload.run : run))
      toast.success(t('reviewPackets.sendComplete', 'Review packet summary sent'))
    } catch (error) {
      console.error('Failed to send review packet summary', error)
      toast.error(
        error instanceof Error
          ? error.message
          : t('reviewPackets.sendFailed', 'Failed to send review packet summary')
      )
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('reviewPackets.title', 'Review packet ops')}</DialogTitle>
          <DialogDescription>
            {t(
              'reviewPackets.description',
              'Import reviewed CSV/XLSX feedback by packet run, then preview or send the WeChat summary.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="review-packet-run-select">{t('reviewPackets.run', 'Packet run')}</Label>
              <Select
                id="review-packet-run-select"
                value={selectedRunId}
                onChange={(event) => setSelectedRunId(event.target.value)}
                options={runs.length
                  ? runs.map((run) => ({ value: run.id, label: formatRunLabel(run) }))
                  : [{ value: '', label: t('reviewPackets.noRuns', 'No review packets yet') }]}
                disabled={loadingRuns || runs.length === 0}
              />
            </div>
            <Button type="button" variant="outline" className="gap-2" onClick={() => void loadRuns()} disabled={loadingRuns}>
              {loadingRuns ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {t('common.refresh', 'Refresh')}
            </Button>
          </div>

          {selectedRun && (
            <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
              <div>{t('reviewPackets.selectedRun', 'Selected run')}: {selectedRun.id}</div>
              <div>{t('reviewPackets.exportedAt', 'Exported at')}: {selectedRun.exportedAt}</div>
              <div>{t('reviewPackets.status', 'Status')}: {selectedRun.status}</div>
              <div>{t('reviewPackets.totalCount', 'Total exported')}: {selectedRun.totalCount}</div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="review-packet-file">{t('reviewPackets.feedbackFile', 'Feedback file')}</Label>
            <div className="flex gap-3">
              <Input
                id="review-packet-file"
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                className="flex-1"
              />
              <Button type="button" className="gap-2" onClick={() => void handleImport()} disabled={importing}>
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {t('reviewPackets.import', 'Import')}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="review-packet-webhook">{t('reviewPackets.webhook', 'WeChat webhook URL')}</Label>
            <Input
              id="review-packet-webhook"
              value={webhookUrl}
              onChange={(event) => setWebhookUrl(event.target.value)}
              placeholder={t('reviewPackets.webhookPlaceholder', 'Optional. Leave blank to use the server default webhook.')}
            />
          </div>

          <div className="flex gap-3">
            <Button type="button" variant="outline" className="gap-2" onClick={() => void handlePreview()} disabled={previewing}>
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {t('reviewPackets.preview', 'Preview summary')}
            </Button>
            <Button type="button" className="gap-2" onClick={() => void handleSend()} disabled={sending}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {t('reviewPackets.send', 'Send summary')}
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="review-packet-preview">{t('reviewPackets.previewContent', 'Summary preview')}</Label>
            <Textarea
              id="review-packet-preview"
              value={previewContent}
              rows={12}
              placeholder={t('reviewPackets.previewPlaceholder', 'Preview content will appear here after you generate it.')}
              readOnly
            />
          </div>

          {warnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="font-medium">{t('reviewPackets.warnings', 'Warnings')}</div>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {warnings.slice(0, 8).map((warning, index) => (
                  <li key={`${warning}-${index}`}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close', 'Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
