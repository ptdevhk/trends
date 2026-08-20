import { Loader2, WandSparkles } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { rawApiClient } from '@/lib/api-helpers'

type ExtractKeywordsResponse = {
  success: boolean
  keywords?: string[]
  model?: string
}

type JdPastePopoverProps = {
  compact?: boolean
  onApplyKeywords: (keywords: string[]) => void
  onClose: () => void
}

export function JdPastePopover({
  compact = false,
  onApplyKeywords,
  onClose,
}: JdPastePopoverProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const submit = async () => {
    const trimmedValue = value.trim()
    if (!trimmedValue) {
      setError(t('resumes.searchPage.jdPaste.emptyError', { defaultValue: 'Paste a job description first' }))
      return
    }

    setLoading(true)
    setError(undefined)

    const { data, error: requestError } = await rawApiClient.POST<ExtractKeywordsResponse>('/api/job-descriptions/extract-keywords', {
      body: {
        text: trimmedValue,
      },
    })

    setLoading(false)

    if (requestError || !data?.success) {
      setError(t('resumes.searchPage.jdPaste.extractError', { defaultValue: 'Failed to extract keywords from the job description' }))
      return
    }

    if (!data.keywords || data.keywords.length === 0) {
      setError(t('resumes.searchPage.jdPaste.noKeywordsError', { defaultValue: 'No useful keywords were extracted' }))
      return
    }

    onApplyKeywords(data.keywords)
    setValue('')
    setError(undefined)
    onClose()
  }

  return (
    <div className="absolute right-0 top-[calc(100%+0.75rem)] z-40 w-[calc(100vw-2rem)] max-w-[30rem] overflow-hidden rounded-[1.75rem] border bg-background shadow-[0_30px_80px_-40px_rgba(15,23,42,0.45)]">
      <div className="border-b px-5 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <WandSparkles className="h-4 w-4 text-amber-600" />
          {t('resumes.searchPage.jdPaste.title', { defaultValue: 'Paste JD to extract keywords' })}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('resumes.searchPage.jdPaste.description', { defaultValue: 'We only extract search terms. Nothing is written back to the job description.' })}
        </p>
      </div>

      <div className="space-y-4 p-5">
        <Textarea
          autoFocus
          value={value}
          className={compact ? 'min-h-[180px]' : 'min-h-[220px]'}
          placeholder={t('resumes.searchPage.jdPaste.placeholder', { defaultValue: 'Paste the job description text here to extract role, product, and domain keywords.' })}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }

            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            }
          }}
        />

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {t('resumes.searchPage.jdPaste.tipPrefix', { defaultValue: 'Tip: use' })}{' '}
            <span className="font-medium">Ctrl/Cmd + Enter</span>{' '}
            {t('resumes.searchPage.jdPaste.tipSuffix', { defaultValue: 'to extract.' })}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('resumes.searchPage.jdPaste.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button type="button" onClick={() => void submit()} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('resumes.searchPage.jdPaste.extracting', { defaultValue: 'Extracting...' })}
                </>
              ) : (
                t('resumes.searchPage.jdPaste.extract', { defaultValue: 'Extract keywords' })
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
