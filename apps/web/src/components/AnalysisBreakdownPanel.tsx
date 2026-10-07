import { toDisplayMatchBreakdown } from '@/lib/resume-scoring'
import type { MatchBreakdown } from '@/types/resume'

function formatSnakeCaseLabel(value: string): string {
  return value.replace(/_/g, ' ')
}

function BreakdownBar({ breakdown }: { breakdown: Record<string, number> }) {
  const relatedExp = breakdown.related_exp ?? 0
  const industryDb = breakdown.industry_db ?? 0
  const total = relatedExp + industryDb
  if (total <= 0) return null
  const relatedPct = Math.round((relatedExp / total) * 100)
  const industryPct = 100 - relatedPct
  return (
    <div className="space-y-1.5" data-testid="analysis-breakdown-bar">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full bg-blue-500 transition-all"
          style={{ width: `${relatedPct}%` }}
          title={`${formatSnakeCaseLabel('related_exp')}: ${relatedExp}`}
        />
        <div
          className="h-full bg-emerald-500 transition-all"
          style={{ width: `${industryPct}%` }}
          title={`${formatSnakeCaseLabel('industry_db')}: ${industryDb}`}
        />
      </div>
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
          {formatSnakeCaseLabel('related_exp')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          {formatSnakeCaseLabel('industry_db')}
        </span>
      </div>
    </div>
  )
}

type AnalysisBreakdownPanelProps = {
  /** Raw audit-factor breakdown (related_exp 0-100). Display conversion happens once here. */
  breakdown: MatchBreakdown | Record<string, number> | undefined
  title?: string
  className?: string
  /** test id for the tile grid (kept for ResumeDetail regressions) */
  gridTestId?: string
}

/**
 * Shared AI analysis breakdown: stacked bar + Industry Db / Related Exp tiles.
 * Same UI as the expanded search card; used by 查看 detail and public share.
 */
export function AnalysisBreakdownPanel({
  breakdown,
  title,
  className,
  gridTestId = 'analysis-breakdown-grid',
}: AnalysisBreakdownPanelProps) {
  const displayBreakdown = toDisplayMatchBreakdown(breakdown)
  if (!displayBreakdown) return null

  return (
    <div className={className ?? 'space-y-2'} data-testid="analysis-breakdown-panel">
      {title ? (
        <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {title}
        </div>
      ) : null}
      <BreakdownBar breakdown={displayBreakdown} />
      <div
        data-testid={gridTestId}
        className="grid gap-2 sm:grid-cols-2"
      >
        {Object.entries(displayBreakdown).map(([label, value]) => (
          <div
            key={label}
            className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border bg-slate-50 px-3 py-2"
          >
            <span className="min-w-0 flex-1 break-words capitalize text-slate-600">
              {formatSnakeCaseLabel(label)}
            </span>
            <span className="shrink-0 font-semibold text-slate-900">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
