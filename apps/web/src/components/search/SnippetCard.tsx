import { ChevronDown, ChevronUp, MapPin, Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { ResumeSearchResultItem } from '@/components/search/search-types'
import { SnippetCardExpanded } from '@/components/search/SnippetCardExpanded'
import { cn } from '@/lib/utils'

type SnippetCardProps = {
  expanded: boolean
  item: ResumeSearchResultItem
  showAiScore?: boolean
  onToggleExpanded: () => void
}

function getPrimaryHeadline(item: ResumeSearchResultItem, fallbackLabel: string): string {
  const latestWorkEntry = item.resume.workHistory?.[0]
  if (latestWorkEntry?.jobTitle) {
    return latestWorkEntry.jobTitle
  }

  return item.resume.jobIntention || fallbackLabel
}

export function SnippetCard({ expanded, item, showAiScore = false, onToggleExpanded }: SnippetCardProps) {
  const { t } = useTranslation()
  const analysis = item.analysis ?? item.resume.analysis
  const snippetText = item.resume.workHistory?.[0]?.raw || item.resume.selfIntro
  const visibleKeywords = (
    item.resume._provenance?.map((entry) => entry.term)
    ?? item.resume.ingestData?.industryTags
    ?? []
  ).slice(0, 3)
  const score = item.score
  const hasAiScore = showAiScore && item.scoreSource === 'ai' && typeof score === 'number'
  const hasRuleScore = !showAiScore && typeof score === 'number'
  const pendingAiScore = showAiScore && !hasAiScore
  const scoreClassName =
    typeof score === 'number'
      ? score >= 90
        ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
        : score >= 70
          ? 'bg-sky-100 text-sky-700 border-sky-200'
          : score >= 50
            ? 'bg-amber-100 text-amber-700 border-amber-200'
            : 'bg-zinc-100 text-zinc-600 border-zinc-200'
      : ''
  const scoreSourceLabel = item.scoreSource === 'ai'
    ? t('resumes.searchPage.card.ai', { defaultValue: 'AI' })
    : t('resumes.searchPage.card.rule', { defaultValue: 'Rule' })
  const scoreSourceClassName =
    item.scoreSource === 'ai'
      ? 'bg-sky-600 text-white border-sky-700'
      : 'bg-amber-500 text-white border-amber-600'
  const profileOverviewLabel = t('resumes.searchPage.card.profileOverview', {
    defaultValue: 'Profile overview',
  })
  const unnamedResumeLabel = t('resumes.searchPage.card.unnamedResume', {
    defaultValue: 'Unnamed resume',
  })
  const aiSummaryPrefix = t('resumes.searchPage.card.aiSummaryPrefix', {
    defaultValue: 'AI summary',
  })
  const aiPendingLabel = t('resumes.searchPage.card.aiPending', {
    defaultValue: 'AI pending',
  })
  const expandLabel = t('resumes.searchPage.card.expand', {
    defaultValue: 'Expand',
  })
  const collapseLabel = t('resumes.searchPage.card.collapse', {
    defaultValue: 'Collapse',
  })
  const primaryHeadline = getPrimaryHeadline(item, profileOverviewLabel)

  return (
    <Card className="overflow-hidden rounded-[1.5rem] border-slate-200 bg-white shadow-[0_18px_50px_-40px_rgba(15,23,42,0.7)]">
      <div className="space-y-4 px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="space-y-1">
              <div className="truncate text-lg font-semibold text-slate-900">{item.resume.name || unnamedResumeLabel}</div>
              <div className="truncate text-sm text-slate-600">{primaryHeadline}</div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {item.resume.location ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {item.resume.location}
                </span>
              ) : null}
              {item.resume.experience ? <span>{item.resume.experience}</span> : null}
              {item.resume.ingestData?.experienceLevel ? (
                <Badge variant="outline" className="capitalize">{item.resume.ingestData.experienceLevel}</Badge>
              ) : null}
            </div>

            {snippetText ? (
              <p className="line-clamp-2 text-sm leading-6 text-slate-700">
                {snippetText}
              </p>
            ) : null}

            {item.scoreSource === 'ai' && analysis?.summary ? (
              <p className="line-clamp-2 text-xs leading-5 text-slate-500">
                {aiSummaryPrefix}: {analysis.summary}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {visibleKeywords.map((keyword) => (
                <Badge key={`${item.key}-${keyword}`} variant="secondary">
                  {keyword}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex w-full shrink-0 flex-wrap items-center gap-3 lg:w-auto lg:justify-end">
            {showAiScore ? (
              hasAiScore ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <div className={cn('rounded-full border px-3 py-1.5 text-sm font-semibold whitespace-nowrap', scoreClassName)}>
                    <span className="inline-flex items-center gap-1">
                      <Star className="h-3.5 w-3.5" />
                      {Math.round(score)}
                    </span>
                  </div>
                  <Badge className={cn('border text-[10px] uppercase tracking-wide', scoreSourceClassName)}>
                    {scoreSourceLabel}
                  </Badge>
                </div>
              ) : pendingAiScore ? (
                <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                  {aiPendingLabel}
                </Badge>
              ) : null
            ) : hasRuleScore ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div className={cn('rounded-full border px-3 py-1.5 text-sm font-semibold whitespace-nowrap', scoreClassName)}>
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-3.5 w-3.5" />
                    {Math.round(score)}
                  </span>
                </div>
                {item.scoreSource ? (
                  <Badge variant="outline" className="whitespace-nowrap uppercase">
                    {scoreSourceLabel}
                  </Badge>
                ) : null}
              </div>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="shrink-0 rounded-full whitespace-nowrap"
              onClick={onToggleExpanded}
            >
              {expanded ? collapseLabel : expandLabel}
              {expanded ? <ChevronUp className="ml-2 h-4 w-4" /> : <ChevronDown className="ml-2 h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      {expanded ? <SnippetCardExpanded item={item} showAiScore={showAiScore} /> : null}
    </Card>
  )
}
