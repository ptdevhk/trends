import { formatKeywordQuery, normalizeOptionalString } from '@trends/shared'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { FileText, Loader2, Upload, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { components } from '@/lib/api-types'
import { rawApiClient } from '@/lib/api-helpers'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { reportUiError } from '@/lib/ui-error-reporting'

const ACCEPTED_FILE_TYPES = '.rar,.zip,.pdf,.doc,.docx'

type ManualResumeImportResponse = components['schemas']['ResumeManualImportResponse']
type ManualResumeImportError = components['schemas']['ResumeManualImportError']
type ManualResumeImportResult = ManualResumeImportResponse | ManualResumeImportError
type ManualResumeImportFileResult = components['schemas']['ResumeManualImportFileResult']

type ManualResumeImportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  location?: string
  keywords?: string[]
  onImported?: () => void | Promise<void>
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  const precision = size >= 10 || unitIndex === 0 ? 0 : 1
  return `${size.toFixed(precision)} ${units[unitIndex]}`
}

function getFileFingerprint(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

function mergeFiles(currentFiles: File[], nextFiles: Iterable<File>): File[] {
  const merged = [...currentFiles]
  const seen = new Set(merged.map(getFileFingerprint))

  for (const file of nextFiles) {
    const fingerprint = getFileFingerprint(file)
    if (seen.has(fingerprint)) {
      continue
    }
    seen.add(fingerprint)
    merged.push(file)
  }

  return merged
}

function normalizeKeywords(keywords: string[] | undefined): string | undefined {
  if (!Array.isArray(keywords) || keywords.length === 0) {
    return undefined
  }

  const normalized = formatKeywordQuery(keywords).trim()
  return normalized.length > 0 ? normalized : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSuccessResponse(value: unknown): value is ManualResumeImportResponse {
  return isRecord(value)
    && value.success === true
    && Array.isArray(value.files)
    && isRecord(value.summary)
    && isRecord(value.source)
}

function isErrorResponse(value: unknown): value is ManualResumeImportError {
  return isRecord(value)
    && value.success === false
    && typeof value.error === 'string'
}

function getStatusBadgeClass(status: ManualResumeImportFileResult['status']): string {
  if (status === 'imported') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }
  if (status === 'skipped') {
    return 'border-amber-200 bg-amber-50 text-amber-700'
  }
  return 'border-red-200 bg-red-50 text-red-700'
}

function hasImportedFiles(result: ManualResumeImportResponse): boolean {
  return result.files.some((file) => file.status === 'imported')
}

function getBatchFailureMessage(result: ManualResumeImportResponse, fallbackMessage: string): string {
  const firstProblemFile = result.files.find(
    (file) => (file.status === 'failed' || file.status === 'skipped') && typeof file.error === 'string' && file.error.length > 0
  )
  return firstProblemFile?.error ?? fallbackMessage
}

export function ManualResumeImportDialog({
  open,
  onOpenChange,
  location,
  keywords,
  onImported,
}: ManualResumeImportDialogProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<ManualResumeImportResult | null>(null)

  const keyword = useMemo(() => normalizeKeywords(keywords), [keywords])
  const normalizedLocation = useMemo(() => normalizeOptionalString(location), [location])

  useEffect(() => {
    if (open) {
      return
    }

    setSelectedFiles([])
    setIsDragging(false)
    setSubmitting(false)
    setResult(null)
  }, [open])

  const appendFiles = (files: Iterable<File>) => {
    setSelectedFiles((current) => mergeFiles(current, files))
    setResult(null)
  }

  const removeFile = (fileToRemove: File) => {
    const fingerprint = getFileFingerprint(fileToRemove)
    setSelectedFiles((current) => {
      const remaining = current.filter((file) => getFileFingerprint(file) !== fingerprint)
      if (remaining.length === 0 && inputRef.current) {
        inputRef.current.value = ''
      }
      return remaining
    })
    setResult(null)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    if (event.dataTransfer.files.length === 0) {
      return
    }
    appendFiles(Array.from(event.dataTransfer.files))
  }

  const handleSubmit = async () => {
    if (selectedFiles.length === 0) {
      toast.error(t('manualResumeImport.selectFilesFirst', 'Select at least one file to import'))
      return
    }

    setSubmitting(true)
    setResult(null)

    try {
      const formData = new FormData()
      selectedFiles.forEach((file) => {
        formData.append('files', file)
      })
      if (keyword) {
        formData.append('keyword', keyword)
      }
      if (normalizedLocation) {
        formData.append('location', normalizedLocation)
      }

      const { data, error: apiError, response } = await rawApiClient.POST<
        ManualResumeImportResponse | ManualResumeImportError
      >('/api/resumes/manual-import', {
        body: formData,
      })
      const payload: unknown = response?.ok ? data : apiError

      if (!response?.ok) {
        const nextError = isErrorResponse(payload)
          ? payload
          : { success: false as const, error: t('manualResumeImport.importFailed', 'Failed to import resumes') }
        setResult(nextError)
        toast.error(nextError.error)
        return
      }

      if (!isSuccessResponse(payload)) {
        const message = t('manualResumeImport.invalidResponse', 'Received an invalid import response')
        setResult({ success: false, error: message })
        toast.error(message)
        return
      }

      setResult(payload)

      if (hasImportedFiles(payload)) {
        toast.success(t('manualResumeImport.importComplete', 'Resume import completed'))
        await onImported?.()
        return
      }

      toast.error(getBatchFailureMessage(payload, t('manualResumeImport.importFailed', 'Failed to import resumes')))
    } catch (error) {
      reportUiError('Failed to import manual resumes', error)
      const message = error instanceof Error
        ? error.message
        : t('manualResumeImport.importFailed', 'Failed to import resumes')
      setResult({ success: false, error: message })
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('manualResumeImport.title', 'Import resumes')}</DialogTitle>
          <DialogDescription>
            {t(
              'manualResumeImport.description',
              'Upload 51job manual export bundles or files in .rar, .zip, .pdf, .doc, or .docx format.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/20 p-3 text-sm">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
              <span>
                {t('manualResumeImport.location', 'Location')}: {normalizedLocation || '--'}
              </span>
              <span>
                {t('manualResumeImport.keywords', 'Keywords')}: {keyword || '--'}
              </span>
            </div>
          </div>

          <div
            className={cn(
              'rounded-lg border-2 border-dashed p-6 text-center transition-colors',
              isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
            )}
            onDragEnter={(event) => {
              event.preventDefault()
              setIsDragging(true)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={(event) => {
              event.preventDefault()
              setIsDragging(false)
            }}
            onDrop={handleDrop}
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Upload className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="mt-3 space-y-1">
              <p className="text-sm font-medium">
                {t('manualResumeImport.dropzoneTitle', 'Drag and drop resume files here')}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('manualResumeImport.dropzoneSubtitle', 'You can mix archives and direct document uploads in one batch.')}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="mt-4"
              onClick={() => inputRef.current?.click()}
            >
              {t('manualResumeImport.selectFiles', 'Select files')}
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPTED_FILE_TYPES}
              className="hidden"
              data-testid="manual-resume-import-input"
              onChange={(event) => {
                if (event.target.files) {
                  appendFiles(Array.from(event.target.files))
                }
                event.target.value = ''
              }}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">
                {t('manualResumeImport.selectedFiles', 'Selected files')} ({selectedFiles.length})
              </div>
              {selectedFiles.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedFiles([])
                    if (inputRef.current) {
                      inputRef.current.value = ''
                    }
                    setResult(null)
                  }}
                >
                  {t('manualResumeImport.clearFiles', 'Clear')}
                </Button>
              ) : null}
            </div>

            {selectedFiles.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                {t('manualResumeImport.noFiles', 'No files selected yet.')}
              </div>
            ) : (
              <div className="space-y-2">
                {selectedFiles.map((file) => (
                  <div key={getFileFingerprint(file)} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{file.name}</div>
                        <div className="text-xs text-muted-foreground">{formatBytes(file.size)}</div>
                      </div>
                    </div>
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeFile(file)}>
                      <X className="h-4 w-4" />
                      <span className="sr-only">{t('manualResumeImport.removeFile', 'Remove file')}</span>
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {result && !result.success ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <div className="font-medium">{result.error}</div>
              {result.warnings && result.warnings.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                  {result.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {result && result.success ? (
            <div className="space-y-4 rounded-lg border bg-muted/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">
                    {t('manualResumeImport.resultTitle', 'Import summary')}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {result.source.label}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div className="rounded-md border px-3 py-2">
                  <div className="text-xs text-muted-foreground">{t('manualResumeImport.uploadedFiles', 'Uploaded')}</div>
                  <div className="font-semibold">{result.summary.uploadedFiles}</div>
                </div>
                <div className="rounded-md border px-3 py-2">
                  <div className="text-xs text-muted-foreground">{t('manualResumeImport.discoveredFiles', 'Discovered')}</div>
                  <div className="font-semibold">{result.summary.discoveredFiles}</div>
                </div>
                <div className="rounded-md border px-3 py-2">
                  <div className="text-xs text-muted-foreground">{t('manualResumeImport.parsedResumes', 'Parsed')}</div>
                  <div className="font-semibold">{result.summary.parsedResumes}</div>
                </div>
                <div className="rounded-md border px-3 py-2">
                  <div className="text-xs text-muted-foreground">{t('manualResumeImport.imported', 'Imported')}</div>
                  <div className="font-semibold">{result.summary.imported}</div>
                </div>
                <div className="rounded-md border px-3 py-2">
                  <div className="text-xs text-muted-foreground">{t('manualResumeImport.skipped', 'Skipped')}</div>
                  <div className="font-semibold">{result.summary.skipped}</div>
                </div>
                <div className="rounded-md border px-3 py-2">
                  <div className="text-xs text-muted-foreground">{t('manualResumeImport.failed', 'Failed')}</div>
                  <div className="font-semibold">{result.summary.failed}</div>
                </div>
              </div>

              {result.warnings.length > 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  <div className="font-medium">{t('manualResumeImport.warnings', 'Warnings')}</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                    {result.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="space-y-2">
                {result.files.map((file) => (
                  <div key={`${file.uploadName}:${file.entryPath}`} className="rounded-lg border px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{file.entryPath}</span>
                      <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase', getStatusBadgeClass(file.status))}>
                        {file.status}
                      </span>
                    </div>
                    {(file.resumeName || file.profileId || file.error || file.warnings.length > 0) ? (
                      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {file.resumeName ? <div>{t('manualResumeImport.resumeName', 'Resume')}: {file.resumeName}</div> : null}
                        {file.profileId ? <div>{t('manualResumeImport.profileId', 'Profile ID')}: {file.profileId}</div> : null}
                        {file.error ? <div className="text-red-600">{file.error}</div> : null}
                        {file.warnings.map((warning) => (
                          <div key={`${file.entryPath}:${warning}`} className="text-amber-700">{warning}</div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.close', 'Close')}
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={submitting || selectedFiles.length === 0}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('manualResumeImport.importing', 'Importing...')}
              </>
            ) : (
              t('manualResumeImport.submit', 'Import resumes')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
