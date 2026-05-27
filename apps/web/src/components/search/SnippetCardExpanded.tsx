import { buildWorkHistoryDateRange, normalizeWorkHistoryEntry, sanitizeResumeRecordForSurface, selectLatestWorkHistory } from '@trends/shared'
import { BriefcaseBusiness, Bug, ChevronDown, Copy, ExternalLink, MapPin, School, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { toast } from 'sonner'
import { useResumeFieldUsagePolicy } from '@/contexts/ResumeFieldUsagePolicyContext'
import { cn } from '@/lib/utils'
import { getResumeContentLocale, getExperienceBadge, isSafeProfileUrl, summarizeBrandHits } from '@/lib/resume-scoring'
import { useBrandDisplayMap } from '@/hooks/useBrandDisplayMap'
import type { ResumeSearchResultItem } from '@/components/search/search-types'

import type { CandidateActionType, CandidateStatus } from '@/types/resume'

type SnippetCardExpandedProps = {
  item: ResumeSearchResultItem
  showAiScore?: boolean
  onViewDetails?: () => void
  // actions
  actionType?: CandidateActionType
  onAction?: (resumeId: string, actionType: CandidateActionType) => void
  candidateStatus?: CandidateStatus
  onCandidateStatusChange?: (identityKey: string, status: CandidateStatus, notes?: string) => void
  statusOptions?: Array<{ value: CandidateStatus; labelKey: string }>
  onBlockTrigger?: () => void
  onNoteTrigger?: () => void
  userRating?: number
}

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
    <div className="space-y-1.5">
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

function buildWorkHistorySupplement(entry: {
  raw?: string
  companyName?: string
  jobTitle?: string
  startDate?: string
  endDate?: string
}): string {
  const raw = entry.raw?.trim()
  if (!raw) {
    return ''
  }

  let remainder = raw
  const dateRange = buildWorkHistoryDateRange(entry.startDate, entry.endDate)
  for (const token of [dateRange, entry.companyName, entry.jobTitle]) {
    const normalizedToken = token?.trim()
    if (!normalizedToken) {
      continue
    }
    remainder = remainder.replace(normalizedToken, ' ')
  }

  return remainder.replace(/\s+/g, ' ').replace(/^[·•|/~-]+|[·•|/~-]+$/g, '').trim()
}

export function SnippetCardExpanded({
  item,
  showAiScore = false,
  onViewDetails,
  actionType,
  onAction,
  candidateStatus,
  onCandidateStatusChange,
  statusOptions,
  onBlockTrigger,
  onNoteTrigger,
  userRating,
}: SnippetCardExpandedProps) {
  const { t } = useTranslation()
  const fieldUsagePolicy = useResumeFieldUsagePolicy()
  const contentLocale = getResumeContentLocale(item.resume)
  const [showDebug, setShowDebug] = useState(false)
  const analysis = item.analysis ?? item.resume.analysis
  const hasAiAnalysis = item.scoreSource === 'ai' && Boolean(analysis)
  const pendingAiAnalysis = showAiScore && !hasAiAnalysis
  const scoreSourceLabel = hasAiAnalysis
    ? t('resumes.searchPage.card.aiAnalysis', { defaultValue: 'AI 分析' })
    : pendingAiAnalysis
      ? t('resumes.searchPage.card.aiAnalysisPending', { defaultValue: 'AI 分析中' })
      : t('resumes.searchPage.card.scoreSource', { defaultValue: '评分来源' })
  let scoreBadgeLabel: string | null = null
  if (hasAiAnalysis && typeof item.score === 'number') {
    scoreBadgeLabel = t('resumes.searchPage.card.aiScoreShort', {
      score: Math.round(item.score),
      defaultValue: 'AI {{score}}分',
    })
  } else if (showAiScore) {
    scoreBadgeLabel = t('resumes.searchPage.card.aiPending', { defaultValue: 'AI 测算中' })
  } else if (typeof item.score === 'number') {
    scoreBadgeLabel = item.scoreSource === 'ai'
      ? t('resumes.searchPage.card.aiScoreShort', {
        score: Math.round(item.score),
        defaultValue: 'AI {{score}}分',
      })
      : t('resumes.searchPage.card.ruleScoreShort', {
        score: Math.round(item.score),
        defaultValue: '规则 {{score}}分',
      })
  }
  const scoreBadgeClassName = pendingAiAnalysis
    ? 'whitespace-nowrap uppercase border-slate-200 bg-slate-50 text-slate-600'
    : 'whitespace-nowrap uppercase'
  const snapshotLabel = t('resumes.searchPage.card.snapshot', {
    defaultValue: '简历快照',
  })
  const recentWorkLabel = t('resumes.searchPage.card.recentWork', {
    defaultValue: '最近工作',
  })
  const analysisBreakdownLabel = t('resumes.searchPage.card.analysisBreakdown', {
    defaultValue: '分析细节',
  })
  const noDetailedBreakdownLabel = t('resumes.searchPage.card.noDetailedBreakdown', {
    defaultValue: '暂无详细分数拆解',
  })
  const noSummaryLabel = t('resumes.searchPage.card.noSummary', {
    defaultValue: '该简历暂无AI摘要。',
  })
  const noStructuredWorkHistoryLabel = t('resumes.searchPage.card.noStructuredWorkHistory', {
    defaultValue: '暂无结构化工作经历。',
  })
  const noLocationLabel = t('resumes.searchPage.card.noLocation', {
    defaultValue: '无地点',
  })
  const noEducationLabel = t('resumes.searchPage.card.noEducation', {
    defaultValue: '无学历信息',
  })
  const resumeMetadataLabel = t('resumes.searchPage.card.resumeMetadata', {
    defaultValue: '简历元数据',
  })
  const signalsLabel = t('resumes.searchPage.card.signals', {
    defaultValue: '核心信号',
  })
  const openSourceProfileLabel = t('resumes.searchPage.card.openSourceProfile', {
    defaultValue: '开源档案',
  })
  const viewDetailsLabel = t('resumes.actions.view', {
    defaultValue: '查看详情',
  })
  const aiSummaryUnavailableLabel = t('resumes.searchPage.card.aiSummaryUnavailable', {
    defaultValue: '该简历暂未进行 AI 分析。分析完成后将显示评分。',
  })
  const summaryUnavailableLabel = t('resumes.searchPage.card.summaryUnavailable', {
    defaultValue: '该简历暂无 AI 摘要。当前显示分数为规则评分。',
  })
  const statusLabel = t('resumes.searchPage.card.status', {
    defaultValue: '候选人状态',
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
      .map((entry) => normalizeWorkHistoryEntry(entry))
      .filter((entry): entry is NonNullable<ReturnType<typeof normalizeWorkHistoryEntry>> => entry !== null),
    [presentationResume.workHistory]
  )
  const profileUrl = item.resume.profileUrl?.trim()
  const hasProfileUrl = isSafeProfileUrl(profileUrl)
  const isSeekUuidUrl = typeof profileUrl === 'string' && /\.employer\.seek\.com\/candidates\/[0-9a-f]{8}-/i.test(profileUrl)
  const isNameSearchUrl = typeof profileUrl === 'string' && profileUrl.includes('/talentsearch/profiles/search')
  const isSeekUrl = isNameSearchUrl || isSeekUuidUrl
  const profileLinkLabel = isSeekUrl
    ? t('resumes.searchPage.card.searchOnSeek', { defaultValue: '在 Seek 搜尋' })
    : openSourceProfileLabel
  const { resolve: resolveBrand } = useBrandDisplayMap()
  const brandSummary = summarizeBrandHits(item.resume.ingestData?.brandHits)

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
              {workHistory.length > 0 ? workHistory.map((entry, index) => {
                const heading = [entry.companyName, entry.jobTitle].filter(Boolean).join(' · ')
                const dateLine = buildWorkHistoryDateRange(entry.startDate, entry.endDate)
                const supplement = buildWorkHistorySupplement(entry)
                const fallbackLine = entry.raw.trim()

                return (
                  <div
                    key={`${heading || fallbackLine}-${index}`}
                    className="rounded-2xl border bg-white px-3 py-3 text-sm break-words text-slate-700"
                  >
                    {heading ? (
                      <div className="font-medium text-slate-900">{heading}</div>
                    ) : (
                      <div className="font-medium text-slate-900">{fallbackLine}</div>
                    )}
                    {dateLine ? (
                      <div className="mt-1 text-xs text-muted-foreground">{dateLine}</div>
                    ) : null}
                    {supplement ? (
                      <div className="mt-1 text-xs text-slate-500">{supplement}</div>
                    ) : null}
                  </div>
                )
              }) : (
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
                      {t('resumes.searchPage.card.highlights', { defaultValue: '亮点' })}
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
                      {t('resumes.searchPage.card.concerns', { defaultValue: '风险' })}
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
                    <BreakdownBar
                      breakdown={analysis.breakdown}
                    />
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
              {brandSummary.map((brand) => (
                <Badge key={`brand-${brand}`} variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">{resolveBrand(brand)}</Badge>
              ))}
              {getExperienceBadge(item.resume.ingestData?.experienceLevel, t) ? (
                <Badge variant="outline" className={getExperienceBadge(item.resume.ingestData?.experienceLevel, t)!.className}>{getExperienceBadge(item.resume.ingestData?.experienceLevel, t)!.label}</Badge>
              ) : null}
            </div>
          </div>

          {/* Candidate Pipeline section */}
          <div className="rounded-3xl border bg-white p-4">
            <div className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {t('resumes.card.pipelineActions', { defaultValue: '流程操作' })}
            </div>
            <div className="flex flex-col gap-2">
              {/* Status Select */}
              {onCandidateStatusChange && statusOptions ? (
                <div className="flex items-center justify-between gap-3 text-sm text-slate-700">
                  <span className="font-medium text-xs">{statusLabel}</span>
                  <select
                    aria-label={statusLabel}
                    className="flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    value={candidateStatus}
                    onChange={(event) => {
                      const nextStatus = event.target.value as CandidateStatus
                      if (nextStatus) {
                        onCandidateStatusChange(item.identityKey, nextStatus)
                      }
                    }}
                  >
                    {statusOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
                    ))}
                  </select>
                </div>
              ) : null}

              {/* Action Buttons Grid */}
              <div className="mt-2 grid grid-cols-2 gap-2">
                {onAction ? (
                  <>
                    <Button
                      variant={actionType === 'shortlist' ? 'default' : 'outline'}
                      size="sm"
                      className="w-full justify-start gap-2"
                      onClick={() => onAction(item.resume.resumeId, 'shortlist')}
                    >
                      <BriefcaseBusiness className="h-3.5 w-3.5" />
                      {t('resumes.actions.shortlist', { defaultValue: '入选' })}
                    </Button>
                    <Button
                      variant={actionType === 'reject' ? 'destructive' : 'outline'}
                      size="sm"
                      className="w-full justify-start gap-2"
                      onClick={() => onAction(item.resume.resumeId, 'reject')}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {t('resumes.actions.reject', { defaultValue: '淘汰' })}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-start gap-2"
                      onClick={() => onAction(item.resume.resumeId, 'contact')}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {t('resumes.actions.contact', { defaultValue: '联系' })}
                    </Button>
                  </>
                ) : null}

                {onNoteTrigger ? (
                  <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={onNoteTrigger}>
                    <School className="h-3.5 w-3.5" />
                    {t('resumes.status.notes', { defaultValue: '备注' })}
                  </Button>
                ) : null}

                {onBlockTrigger ? (
                  <Button variant={item.blocked ? 'destructive' : 'outline'} size="sm" className="w-full justify-start gap-2 col-span-2" onClick={onBlockTrigger}>
                    <MapPin className="h-3.5 w-3.5" />
                    {item.blocked
                      ? t('resumes.card.unblock', { defaultValue: '解除屏蔽' })
                      : t('resumes.card.block', { defaultValue: '屏蔽' })}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          {/* Debug toggle */}
          <div className="rounded-3xl border bg-white p-4">
            <button
              type="button"
              onClick={() => setShowDebug(!showDebug)}
              className="flex w-full items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground transition-colors"
            >
              <span className="flex items-center gap-2">
                <Bug className="h-3.5 w-3.5" />
                {t('resumes.searchPage.card.debug', { defaultValue: 'Debug' })}
              </span>
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showDebug && 'rotate-180')} />
            </button>

            {showDebug && (
              <div className="mt-4 space-y-4">
                {/* Score sub-dimensions — each key from LLM breakdown */}
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">
                    {t('resumes.searchPage.card.scoreDimensions', { defaultValue: 'Score Dimensions' })}
                  </div>
                  {[
                    { key: 'related_exp', label: t('resumes.searchPage.card.relatedExp', { defaultValue: 'Related Exp' }) },
                    { key: 'skills', label: t('resumes.searchPage.card.skills', { defaultValue: 'Skills' }) },
                    { key: 'industry_db', label: t('resumes.searchPage.card.industryDb', { defaultValue: 'Industry DB' }) },
                    { key: 'education', label: t('resumes.searchPage.card.education', { defaultValue: 'Education' }) },
                    { key: 'location', label: t('resumes.searchPage.card.location', { defaultValue: 'Location' }) },
                  ].map(({ key, label }) => {
                    const score = (analysis?.breakdown as Record<string, number> | undefined)?.[key] ?? 0
                    return (
                      <div key={key} className="space-y-0.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">
                            {label}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">{Math.round(typeof score === 'number' ? score : 0)}</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary/60 transition-all"
                            style={{ width: `${Math.min(100, typeof score === 'number' ? score : 0)}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Score comparison — AI vs confirmed vs user */}
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground">
                    {t('resumes.searchPage.card.scoreComparison', { defaultValue: 'Score Comparison' })}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg border bg-slate-50 p-2">
                      <div className="text-[10px] text-muted-foreground">{t('resumes.searchPage.card.aiScore', { defaultValue: 'AI Score' })}</div>
                      <div className="text-sm font-bold">{typeof item.score === 'number' ? Math.round(item.score) : '-'}</div>
                    </div>
                    <div className="rounded-lg border bg-slate-50 p-2">
                      <div className="text-[10px] text-muted-foreground">{t('resumes.searchPage.card.confirmed', { defaultValue: 'Confirmed' })}</div>
                      <div className="text-sm font-bold">{typeof item.resume.confirmedScore === 'number' ? Math.round(item.resume.confirmedScore) : '-'}</div>
                    </div>
                    <div className="rounded-lg border bg-slate-50 p-2">
                      <div className="text-[10px] text-muted-foreground">{t('resumes.searchPage.card.yourRating', { defaultValue: 'Your Rating' })}</div>
                      <div className="text-sm font-bold">{typeof userRating === 'number' ? userRating : '-'}</div>
                    </div>
                  </div>
                </div>

                {/* Raw analysis JSON with copy */}
                {analysis ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-medium text-muted-foreground">
                        {t('resumes.searchPage.card.analysisJson', { defaultValue: 'Analysis JSON' })}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(JSON.stringify(analysis, null, 2)).then(() => {
                            toast.success(t('resumes.searchPage.card.jsonCopied', { defaultValue: 'JSON copied' }))
                          }).catch(() => {
                            toast.error(t('resumes.searchPage.card.copyFailed', { defaultValue: 'Copy failed' }))
                          })
                        }}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Copy className="h-3 w-3" />
                        {t('resumes.searchPage.card.copyJson', { defaultValue: 'Copy' })}
                      </button>
                    </div>
                    <pre className="max-h-48 overflow-auto rounded-md border bg-muted/40 p-3 text-[10px] leading-relaxed">{JSON.stringify(analysis, null, 2)}</pre>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {(onViewDetails || hasProfileUrl) ? (
            <div className="flex flex-col gap-2">
              {onViewDetails ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-center rounded-xl"
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
                  title={isSeekUuidUrl ? t('resumes.searchPage.card.seekSessionRequired', { defaultValue: 'Requires active Seek session' }) : undefined}
                  className={cn(buttonVariants({ variant: 'outline' }), 'w-full justify-center rounded-xl')}
                >
                  {profileLinkLabel}
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
