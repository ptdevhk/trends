import { Sparkles } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

type AiSummaryPanelProps = {
  generatedAt?: number
  loading?: boolean
  summary?: string
}

function formatGeneratedAt(value: number | undefined): string | null {
  if (!value) {
    return null
  }

  const elapsedMinutes = Math.max(0, Math.round((Date.now() - value) / 60_000))
  if (elapsedMinutes < 1) {
    return 'Generated just now'
  }

  if (elapsedMinutes === 1) {
    return 'Generated 1 minute ago'
  }

  return `Generated ${elapsedMinutes} minutes ago`
}

export function AiSummaryPanel({ generatedAt, loading = false, summary }: AiSummaryPanelProps) {
  return (
    <Card className="hidden rounded-[1.75rem] border-slate-200 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white shadow-[0_28px_70px_-46px_rgba(15,23,42,0.9)] md:block">
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-300">
          <Sparkles className="h-4 w-4" />
          AI result summary
        </div>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full bg-white/15" />
            <Skeleton className="h-4 w-5/6 bg-white/15" />
            <Skeleton className="h-4 w-4/6 bg-white/15" />
          </div>
        ) : (
          <p className="text-sm leading-7 text-slate-100">
            {summary || 'No summary is available for the current search yet.'}
          </p>
        )}

        {formatGeneratedAt(generatedAt) ? (
          <div className="text-xs text-slate-400">{formatGeneratedAt(generatedAt)}</div>
        ) : null}
      </CardContent>
    </Card>
  )
}
