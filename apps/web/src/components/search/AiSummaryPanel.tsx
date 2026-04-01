import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

type AiSummaryPanelProps = {
  generatedAt?: number
  loading?: boolean
  summary?: string
}

function formatGeneratedAt(
  value: number | undefined,
  t: (key: string, options?: { count?: number; defaultValue?: string }) => string,
): string | null {
  if (!value) {
    return null
  }

  const elapsedMinutes = Math.max(0, Math.round((Date.now() - value) / 60_000))
  if (elapsedMinutes < 1) {
    return t('resumes.searchPage.aiSummary.generatedJustNow', {
      defaultValue: 'Generated just now',
    })
  }

  if (elapsedMinutes === 1) {
    return t('resumes.searchPage.aiSummary.generatedOneMinuteAgo', {
      defaultValue: 'Generated 1 minute ago',
    })
  }

  return t('resumes.searchPage.aiSummary.generatedMinutesAgo', {
    count: elapsedMinutes,
    defaultValue: 'Generated {{count}} minutes ago',
  })
}

export function AiSummaryPanel({ generatedAt, loading = false, summary }: AiSummaryPanelProps) {
  const { t } = useTranslation()
  const generatedAtLabel = formatGeneratedAt(generatedAt, t)
  const titleLabel = t('resumes.searchPage.aiSummary.title', {
    defaultValue: 'AI result summary',
  })
  const summaryLabel = summary || t('resumes.searchPage.aiSummary.noSummary', {
    defaultValue: 'No summary is available for the current search yet.',
  })

  return (
    <Card className="hidden rounded-[1.75rem] border-slate-200 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white shadow-[0_28px_70px_-46px_rgba(15,23,42,0.9)] md:block">
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-300">
          <Sparkles className="h-4 w-4" />
          {titleLabel}
        </div>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full bg-white/15" />
            <Skeleton className="h-4 w-5/6 bg-white/15" />
            <Skeleton className="h-4 w-4/6 bg-white/15" />
          </div>
        ) : (
          <p className="text-sm leading-7 text-slate-100">
            {summaryLabel}
          </p>
        )}

        {generatedAtLabel ? (
          <div className="text-xs text-slate-400">{generatedAtLabel}</div>
        ) : null}
      </CardContent>
    </Card>
  )
}
