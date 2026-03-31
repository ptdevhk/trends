import { buildWorkHistoryEntryText, sanitizeResumeRecordForSurface, selectLatestWorkHistory } from '@trends/shared'
import { BriefcaseBusiness, ExternalLink, MapPin, School, Sparkles } from 'lucide-react'
import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { useResumeFieldUsagePolicy } from '@/contexts/ResumeFieldUsagePolicyContext'
import { cn } from '@/lib/utils'
import { isSafeProfileUrl } from '@/lib/resume-scoring'
import type { ResumeSearchResultItem } from '@/components/search/search-types'

type SnippetCardExpandedProps = {
  item: ResumeSearchResultItem
}

function formatStatusLabel(value: string): string {
  return value.replace(/_/g, ' ')
}

function formatBreakdownLabel(value: string): string {
  return value.replace(/_/g, ' ')
}

export function SnippetCardExpanded({ item }: SnippetCardExpandedProps) {
  const fieldUsagePolicy = useResumeFieldUsagePolicy()
  const analysis = item.analysis ?? item.resume.analysis
  const hasAiAnalysis = item.scoreSource === 'ai' && Boolean(analysis)
  const presentationResume = useMemo(
    () => sanitizeResumeRecordForSurface(item.resume, 'presentation', fieldUsagePolicy),
    [fieldUsagePolicy, item.resume]
  )
  const workHistory = useMemo(
    () => selectLatestWorkHistory(presentationResume.workHistory)
      .map((entry) => buildWorkHistoryEntryText(entry))
      .filter((entry) => entry.length > 0)
      .slice(0, 4),
    [presentationResume.workHistory]
  )
  const profileUrl = item.resume.profileUrl?.trim()
  const hasProfileUrl = isSafeProfileUrl(profileUrl)

  return (
    <div className="border-t bg-slate-50/70 px-5 py-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr),minmax(0,0.9fr)]">
        <div className="min-w-0 space-y-4">
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Snapshot
            </div>
            <p className="break-words text-sm leading-6 text-slate-700">
              {presentationResume.selfIntro?.trim() || presentationResume.jobIntention?.trim() || 'No summary available for this resume yet.'}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <BriefcaseBusiness className="h-3.5 w-3.5" />
              Recent work
            </div>
            <div className="space-y-2">
              {workHistory.length > 0 ? workHistory.map((entry) => (
                <div key={entry} className="rounded-2xl border bg-white px-3 py-2 text-sm break-words text-slate-700">
                  {entry}
                </div>
              )) : (
                <div className="rounded-2xl border border-dashed bg-white px-3 py-3 text-sm text-muted-foreground">
                  No structured work history available.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <div className="rounded-3xl border bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {hasAiAnalysis ? 'AI analysis' : 'Score source'}
              </div>
              {typeof item.score === 'number' ? (
                <Badge variant="outline" className="whitespace-nowrap uppercase">
                  {item.scoreSource === 'ai' ? `AI ${Math.round(item.score)}` : `Rule ${Math.round(item.score)}`}
                </Badge>
              ) : null}
            </div>
            {hasAiAnalysis && analysis ? (
              <div className="space-y-4 break-words text-sm text-slate-700">
                <p className="leading-6">{analysis.summary || 'No AI summary available for this resume yet.'}</p>

                {analysis.highlights.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      Highlights
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {analysis.highlights.slice(0, 6).map((highlight) => (
                        <Badge key={highlight} variant="secondary">{highlight}</Badge>
                      ))}
                    </div>
                  </div>
                ) : null}

                {analysis.concerns && analysis.concerns.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      Concerns
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {analysis.concerns.slice(0, 6).map((concern) => (
                        <Badge key={concern} variant="outline">{concern}</Badge>
                      ))}
                    </div>
                  </div>
                ) : null}

                {analysis.breakdown && Object.keys(analysis.breakdown).length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      Breakdown
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {Object.entries(analysis.breakdown).map(([label, value]) => (
                        <div
                          key={label}
                          className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border bg-slate-50 px-3 py-2"
                        >
                          <span className="min-w-0 flex-1 break-words capitalize text-slate-600">{formatBreakdownLabel(label)}</span>
                          <span className="shrink-0 font-semibold text-slate-900">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-sm leading-6 text-slate-700">
                AI summary is not available for this resume. The current visible score comes from rule scoring only.
              </p>
            )}
          </div>

          <div className="rounded-3xl border bg-white p-4">
            <div className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Resume metadata
            </div>
            <div className="space-y-3 text-sm text-slate-700">
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>{presentationResume.location || 'No location'}</span>
              </div>
              <div className="flex items-start gap-2">
                <School className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>{presentationResume.education || 'No education listed'}</span>
              </div>
              <div className="flex items-start gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>Status: {formatStatusLabel(item.status)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border bg-white p-4">
            <div className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Signals
            </div>
            <div className="flex flex-wrap gap-2">
              {(item.resume.ingestData?.industryTags ?? []).slice(0, 8).map((tag) => (
                <Badge key={tag} variant="secondary">{tag}</Badge>
              ))}
              {(item.resume.ingestData?.companyHits ?? []).slice(0, 5).map((company) => (
                <Badge key={company} variant="outline">{company}</Badge>
              ))}
              {item.resume.ingestData?.experienceLevel ? (
                <Badge variant="outline" className="capitalize">{item.resume.ingestData.experienceLevel}</Badge>
              ) : null}
            </div>
          </div>

          {hasProfileUrl ? (
            <a
              href={profileUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: 'outline' }), 'w-full justify-center rounded-full')}
            >
              Open source profile
              <ExternalLink className="ml-2 h-4 w-4" />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  )
}
