import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

export type ExportFormat = 'csv' | 'xlsx'

export type ExportDialogResult = {
  format: ExportFormat
  userComment: string
  referenceNote: string
}

export type ExportBatchMeta = Pick<ExportDialogResult, 'userComment' | 'referenceNote'>

interface ExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedCount: number
  defaultFormat?: ExportFormat
  onConfirm: (result: ExportDialogResult) => void
}

function toExportFormat(value: string): ExportFormat {
  return value === 'xlsx' ? 'xlsx' : 'csv'
}

export function ExportDialog({
  open,
  onOpenChange,
  selectedCount,
  defaultFormat = 'csv',
  onConfirm,
}: ExportDialogProps) {
  const { t } = useTranslation()
  const [format, setFormat] = useState<ExportFormat>(defaultFormat)
  const [userComment, setUserComment] = useState('')
  const [referenceNote, setReferenceNote] = useState('')

  const resetForm = () => {
    setFormat(defaultFormat)
    setUserComment('')
    setReferenceNote('')
  }

  useEffect(() => {
    if (open) {
      setFormat(defaultFormat)
    }
  }, [defaultFormat, open])

  const handleConfirm = () => {
    onConfirm({
      format,
      userComment: userComment.trim(),
      referenceNote: referenceNote.trim(),
    })
    resetForm()
    onOpenChange(false)
  }

  const handleCancel = () => {
    resetForm()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('export.dialog.title', 'Export Resumes')}
          </DialogTitle>
          <DialogDescription>
            {t('export.dialog.description', {
              count: selectedCount,
              defaultValue: `Export ${selectedCount} selected resume(s). Add optional comments before exporting.`,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="export-format">
              {t('export.dialog.formatLabel', 'Format')}
            </Label>
            <Select
              value={format}
              onChange={(e) => setFormat(toExportFormat(e.target.value))}
              options={[
                { value: 'csv', label: 'CSV' },
                { value: 'xlsx', label: 'XLSX' },
              ]}
              className="w-full"
              data-testid="export-format-select"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="export-comment">
              {t('export.dialog.commentLabel', 'Comment')}
            </Label>
            <Textarea
              id="export-comment"
              value={userComment}
              onChange={(e) => setUserComment(e.target.value)}
              placeholder={t('export.dialog.commentPlaceholder', 'Add a comment for this export (optional)')}
              className="min-h-[60px]"
              data-testid="export-comment"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="export-reference">
              {t('export.dialog.referenceLabel', 'Reference Note')}
            </Label>
            <Textarea
              id="export-reference"
              value={referenceNote}
              onChange={(e) => setReferenceNote(e.target.value)}
              placeholder={t('export.dialog.referencePlaceholder', 'Add a reference note (optional)')}
              className="min-h-[60px]"
              data-testid="export-reference"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={handleConfirm} className="gap-2">
            <Download className="h-4 w-4" />
            {t('export.dialog.confirm', 'Export')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
