import { Check, ClipboardList, FileUp, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { rawApiClient } from '@/lib/api-helpers'
import { parseHrFeedbackRows, type HrFeedbackRow } from '@/lib/hr-feedback-import'

type FeedbackBatchResult = {
  resumeId: string
  name?: string
  comments: string
  status: 'imported' | 'skipped' | 'notFound'
  actionId?: number
  reason?: string
}

type FeedbackBatchResponse = {
  success: true
  total: number
  imported: number
  skipped: number
  notFound: string[]
  results: FeedbackBatchResult[]
}

const sampleInput = [
  'k172ydnrexaqrhq66myhqqd1r18885k3\t舒先生\t半導體，行業不匹配',
  'k17475zbw6pmv5yw6crwr7dd1s899scn\t謝先生\t寶力離職銷售',
].join('\n')

function resultTone(status: FeedbackBatchResult['status'] | 'ready'): 'default' | 'secondary' | 'destructive' {
  if (status === 'notFound') {
    return 'destructive'
  }
  if (status === 'skipped') {
    return 'secondary'
  }
  return 'default'
}

export function HrFeedbackImportDialog({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [rawText, setRawText] = useState('')
  const [rows, setRows] = useState<HrFeedbackRow[]>([])
  const [results, setResults] = useState<FeedbackBatchResult[]>([])
  const [isImporting, setIsImporting] = useState(false)

  const handleParse = () => {
    try {
      const parsedRows = parseHrFeedbackRows(rawText)
      const validRows = parsedRows.filter((row) => row.resumeId.trim().length > 0)
      setRows(validRows)
      setResults([])
      if (validRows.length === 0) {
        toast.error(t('resumes.hrFeedbackImport.noRows', { defaultValue: 'No feedback rows found' }))
        return
      }
      toast.success(t('resumes.hrFeedbackImport.parsed', { count: validRows.length, defaultValue: 'Parsed {{count}} rows' }))
    } catch (error) {
      console.error('Failed to parse HR feedback rows', error)
      toast.error(t('resumes.hrFeedbackImport.parseFailed', { defaultValue: 'Failed to parse feedback rows' }))
    }
  }

  const handleImport = async () => {
    if (rows.length === 0) {
      handleParse()
      return
    }

    setIsImporting(true)
    try {
      const { data, error } = await rawApiClient.POST<FeedbackBatchResponse>('/api/resumes/feedback-batch', {
        body: {
          items: rows.map((row) => ({
            resumeId: row.resumeId,
            name: row.name,
            comments: row.comments,
          })),
        },
      })

      if (error || !data?.success) {
        console.error('Failed to import HR feedback batch', error ?? data)
        toast.error(t('resumes.hrFeedbackImport.importFailed', { defaultValue: 'Failed to import feedback' }))
        return
      }

      setResults(data.results)
      toast.success(t('resumes.hrFeedbackImport.imported', {
        imported: data.imported,
        notFound: data.notFound.length,
        defaultValue: 'Imported {{imported}} notes · {{notFound}} not found',
      }))
    } catch (error) {
      console.error('Failed to import HR feedback batch', error)
      toast.error(t('resumes.hrFeedbackImport.importFailed', { defaultValue: 'Failed to import feedback' }))
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-10 gap-2 rounded-full px-4"
          disabled={disabled}
        >
          <FileUp className="h-4 w-4" />
          {t('resumes.hrFeedbackImport.trigger', { defaultValue: 'Import HR feedback' })}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t('resumes.hrFeedbackImport.title', { defaultValue: 'Import HR feedback' })}</DialogTitle>
          <DialogDescription>
            {t('resumes.hrFeedbackImport.description', { defaultValue: 'Paste id, name, comments rows to create candidate notes.' })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Textarea
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            placeholder={sampleInput}
            className="min-h-40 font-mono text-sm"
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className="gap-2" onClick={handleParse}>
              <ClipboardList className="h-4 w-4" />
              {t('resumes.hrFeedbackImport.parse', { defaultValue: 'Parse' })}
            </Button>
            <Button
              type="button"
              className="gap-2"
              disabled={rows.length === 0 || isImporting}
              onClick={() => {
                void handleImport()
              }}
            >
              {isImporting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {isImporting
                ? t('resumes.hrFeedbackImport.importing', { defaultValue: 'Importing...' })
                : t('resumes.hrFeedbackImport.confirm', { defaultValue: 'Confirm import' })}
            </Button>
          </div>

          {rows.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[220px]">{t('resumes.hrFeedbackImport.columns.id', { defaultValue: 'ID' })}</TableHead>
                    <TableHead className="w-[120px]">{t('resumes.hrFeedbackImport.columns.name', { defaultValue: 'Name' })}</TableHead>
                    <TableHead>{t('resumes.hrFeedbackImport.columns.comment', { defaultValue: 'Comment' })}</TableHead>
                    <TableHead className="w-[120px]">{t('resumes.hrFeedbackImport.columns.status', { defaultValue: 'Status' })}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, index) => {
                    const result = results[index]
                    const status = result?.status ?? 'ready'
                    return (
                      <TableRow key={`${row.rowNumber}-${row.resumeId}`}>
                        <TableCell className="font-mono text-xs">{row.resumeId}</TableCell>
                        <TableCell>{row.name || '-'}</TableCell>
                        <TableCell className="max-w-md whitespace-normal break-words">{row.comments || '-'}</TableCell>
                        <TableCell>
                          <Badge variant={resultTone(status)}>
                            {t(`resumes.hrFeedbackImport.status.${status}`, { defaultValue: status })}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {t('common.close', { defaultValue: 'Close' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
