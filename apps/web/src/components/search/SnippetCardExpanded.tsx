import { buildWorkHistoryEntryText, sanitizeResumeRecordForSurface, selectLatestWorkHistory } from '@trends/shared'
import { BriefcaseBusiness, ExternalLink, MapPin, School, Sparkles } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { useResumeFieldUsagePolicy } from '@/contexts/ResumeFieldUsagePolicyContext'
import { cn } from '@/lib/utils'
import { getResumeContentLocale, isSafeProfileUrl } from '@/lib/resume-scoring'
import type { ResumeSearchResultItem } from '@/components/search/search-types'

type SnippetCardExpandedProps = {
  item: ResumeSearchResultItem
  showAiScore?: boolean
  onViewDetails?: () => void
}

function formatSnakeCaseLabel(value: string): string {
  return value.replace(/_/g, ' ')
}

export function SnippetCardExpanded({ item, showAiScore = false, onViewDetails }: SnippetCardExpandedProps) {
  const { t } = useTranslation()
  const fieldUsagePolicy = useResumeFieldUsagePolicy()
  const contentLocale = getResumeContentLocale(item.resume)
  const analysis = item.analysis ?? item.resume.analysis
  const hasAiAnalysis = item.scoreSource === 'ai' && Boolean(analysis)
  const pendingAiAnalysis = showAiScore && !hasAiAnalysis
  const scoreSourceLabel = hasAiAnalysis
    ? t('resumes.searchPage.card.aiAnalysis', { defaultValue: 'AI analysis' })
    : pendingAiAnalysis
      ? t('resumes.searchPage.card.aiAnalysisPending', { defaultValue: 'AI analysis pending' })
      : t('resumes.searchPage.card.scoreSource', { defaultValue: 'Score source' })
  let scoreBadgeLabel: string | null = null
  if (hasAiAnalysis && typeof item.score === 'number') {
    scoreBadgeLabel = t('resumes.searchPage.card.aiScoreShort', {
      score: Math.round(item.score),
      defaultValue: 'AI {{score}}',
    })
  } else if (showAiScore) {
    scoreBadgeLabel = t('resumes.searchPage.card.aiPending', { defaultValue: 'AI pending' })
  } else if (typeof item.score === 'number') {
    scoreBadgeLabel = item.scoreSource === 'ai'
      ? t('resumes.searchPage.card.aiScoreShort', {
        score: Math.round(item.score),
        defaultValue: 'AI {{score}}',
      })
      : t('resumes.searchPage.card.ruleScoreShort', {
        score: Math.round(item.score),
        defaultValue: 'Rule {{score}}',
      })
  }
  const scoreBadgeClassName = pendingAiAnalysis
    ? 'whitespace-nowrap uppercase border-slate-200 bg-slate-50 text-slate-600'
    : 'whitespace-nowrap uppercase'
  const snapshotLabel = t('resumes.searchPage.card.snapshot', {
    defaultValue: 'Snapshot',
  })
  const recentWorkLabel = t('resumes.searchPage.card.recentWork', {
    defaultValue: 'Recent work',
  })
  const analysisBreakdownLabel = t('resumes.searchPage.card.analysisBreakdown', {
    defaultValue: 'Analysis Breakdown',
  })
  const noDetailedBreakdownLabel = t('resumes.searchPage.card.noDetailedBreakdown', {
    defaultValue: 'No detailed breakdown available',
  })
  const noSummaryLabel = t('resumes.searchPage.card.noSummary', {
    defaultValue: 'No summary available for this resume yet.',
  })
  const noStructuredWorkHistoryLabel = t('resumes.searchPage.card.noStructuredWorkHistory', {
    defaultValue: 'No structured work history available.',
  })
  const noLocationLabel = t('resumes.searchPage.card.noLocation', {
    defaultValue: 'No location',
  })
  const noEducationLabel = t('resumes.searchPage.card.noEducation', {
    defaultValue: 'No education listed',
  })
  const resumeMetadataLabel = t('resumes.searchPage.card.resumeMetadata', {
    defaultValue: 'Resume metadata',
  })
  const signalsLabel = t('resumes.searchPage.card.signals', {
    defaultValue: 'Signals',
  })
  const openSourceProfileLabel = t('resumes.searchPage.card.openSourceProfile', {
    defaultValue: 'Open source profile',
  })
  const viewDetailsLabel = t('resumes.actions.view', {
    defaultValue: 'View details',
  })
  const aiSummaryUnavailableLabel = t('resumes.searchPage.card.aiSummaryUnavailable', {
    defaultValue: 'AI analysis is not available for this resume yet. The score will appear after analysis completes.',
  })
  const summaryUnavailableLabel = t('resumes.searchPage.card.summaryUnavailable', {
    defaultValue: 'AI summary is not available for this resume. The current visible score comes from rule scoring only.',
  })
  const statusLabel = t('resumes.searchPage.card.status', {
    defaultValue: 'Status',
  })
  const statusValueLabel = t(`resumes.status.options.${item.status}`, {
    defaultValue: formatSnakeCaseLabel(item.status),
  })
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
    <div className="border-t bg-slate-50/70 px-5 py-5" lang={contentLocale}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr),minmax(0,0.9fr)]">
        <div className="min-w-0 space-y-4">
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {snapshotLabel}
            </div>
            <p className="break-words text-sm leading-6 text-slate-700">
              {presentationResume.selfIntro?.trim() || presentationResume.jobIntention?.trim() || noSummaryLabel}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <BriefcaseBusiness className="h-3.5 w-3.5" />
              {recentWorkLabel}
            </div>
            <div className="space-y-2">
              {workHistory.length > 0 ? workHistory.map((entry) => (
                <div key={entry} className="rounded-2xl border bg-white px-3 py-2 text-sm break-words text-slate-700">
                  {entry}
                </div>
              )) : (
                <div className="rounded-2xl border border-dashed bg-white px-3 py-3 text-sm text-muted-foreground">
                  {noStructuredWorkHistoryLabel}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <div className="rounded-3xl border bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {scoreSourceLabel}
              </div>
              {scoreBadgeLabel ? (
                <Badge variant="outline" className={scoreBadgeClassName}>
                  {scoreBadgeLabel}
                </Badge>
              ) : null}
            </div>
            {hasAiAnalysis && analysis ? (
              <div className="space-y-4 break-words text-sm text-slate-700">
                <p className="leading-6">{analysis.summary || noSummaryLabel}</p>

                {analysis.highlights.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      {t('resumes.searchPage.card.highlights', { defaultValue: 'Highlights' })}
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
                      {t('resumes.searchPage.card.concerns', { defaultValue: 'Concerns' })}
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
                      {analysisBreakdownLabel}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {Object.entries(analysis.breakdown).map(([label, value]) => (
                        <div
                          key={label}
                          className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border bg-slate-50 px-3 py-2"
                        >
                          <span className="min-w-0 flex-1 break-words capitalize text-slate-600">{formatSnakeCaseLabel(label)}</span>
                          <span className="shrink-0 font-semibold text-slate-900">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="opacity-70 italic">{noDetailedBreakdownLabel}</p>
                )}
              </div>
            ) : (
              <p className="text-sm leading-6 text-slate-700">
                {showAiScore ? aiSummaryUnavailableLabel : summaryUnavailableLabel}
              </p>
            )}
          </div>

          <div className="rounded-3xl border bg-white p-4">
            <div className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {resumeMetadataLabel}
            </div>
            <div className="space-y-3 text-sm text-slate-700">
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>{presentationResume.location || noLocationLabel}</span>
              </div>
              <div className="flex items-start gap-2">
                <School className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>{presentationResume.education || noEducationLabel}</span>
              </div>
              <div className="flex items-start gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>{statusLabel}: {statusValueLabel}</span>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border bg-white p-4">
            <div className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {signalsLabel}
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

          {onViewDetails || hasProfileUrl ? (
            <div className="flex flex-col gap-2">
              {onViewDetails ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-center rounded-full"
                  onClick={onViewDetails}
                >
                  {viewDetailsLabel}
                </Button>
              ) : null}
              {hasProfileUrl ? (
                <a
                  href={profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(buttonVariants({ variant: 'outline' }), 'w-full justify-center rounded-full')}
                >
                  {openSourceProfileLabel}
                  <ExternalLink className="ml-2 h-4 w-4" />
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
