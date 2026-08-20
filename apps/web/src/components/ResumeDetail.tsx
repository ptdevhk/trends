import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp } from 'lucide-react'
import {
  buildWorkHistoryDateRange,
  buildWorkHistoryDisplayDateLine,
  normalizeWorkHistoryEntry,
  RESUME_AI_PROMPT_LOCALE_TO_NATURAL_LANGUAGE,
  sanitizeResumeRecordForSurface,
  selectLatestWorkHistory,
  type CandidatePolicyOverride,
} from '@trends/shared'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { AiFeedbackButtons } from '@/components/AiFeedbackButtons'
import { ResumeRefreshBadge } from '@/components/ResumeRefreshBadge'
import { StarRating } from '@/components/StarRating'
import type { ResumeItem } from '@/hooks/useResumes'
import type { ConvexResumeItem } from '@/hooks/useConvexResumes'
import type { ResumeRefreshState } from '@/lib/resume-freshness'
import { formatRoleYears, getExperienceBadge, getResumeContentLocale, getResumeSourceLabel, getRoleLabel, hasIngestData, isSafeProfileUrl, summarizeBrandHits, toDisplayMatchBreakdown } from '@/lib/resume-scoring'
import { getScoreClassName } from '@/lib/score-classes'
import { cn, isImeComposition } from '@/lib/utils'
import { useBrandDisplayMap } from '@/hooks/useBrandDisplayMap'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useResumeFieldUsagePolicy } from '@/contexts/ResumeFieldUsagePolicyContext'
import { useResumeWorkHistoryLimit } from '@/contexts/ResumeWorkHistoryLimitContext'
import { CompanyPolicyBadges } from '@/components/CompanyPolicyBadges'
import { getResumeCompanyPolicyState } from '@/lib/company-policy-runtime'
import { CompanyResearchStrip } from '@/components/research/CompanyResearchStrip'
import { useCompanyPolicyIndex } from '@/hooks/useCompanyPolicyIndex'
import { IndustryEvidenceDetail, VerifiedCompanyBadge } from '@/components/industry-evidence/IndustryEvidenceSummary'
import { LegacyIndustryEvidenceNotice } from '@/components/industry-evidence/LegacyIndustryEvidenceNotice'
import {
  findVerifiedIndustrySummaryForCompany,
  getIndustryEvidenceWorkEntryFingerprint,
  getMatchedWorkEntryIndustryEvidenceProvenance,
  getVerifiedIndustryEvidenceSummaries,
  hasLegacyIndustryEvidenceInSignals,
  mergeIndustryEvidenceProvenance,
  type IndustryEvidenceProvenance,
} from '@/components/industry-evidence/industry-evidence'
import { hasSystemAdminAccess, hasWorkspaceIndustryReviewAccess, SYSTEM_ROUTE_PREFIX } from '@/lib/workspace-access'
import { rawApiClient } from '@/lib/api-helpers'
import type { paths } from '@/lib/api-types'

import type { AiFeedbackSentiment, AiFeedbackTarget, MatchingResult } from '@/types/resume'

type ResumeIndustryReviewTargetsResponse = paths['/api/resumes/{resumeId}/industry-review-targets']['get']['responses'][200]['content']['application/json']
type ResumeIndustryReviewTarget = ResumeIndustryReviewTargetsResponse['data']['targets'][number]
type AvailableIndustryReviewTarget = Extract<ResumeIndustryReviewTarget, { availability: 'target_available' }>

interface ResumeDetailProps {
  resume: ResumeItem | ConvexResumeItem | null
  matchResult?: MatchingResult
  open: boolean
  onOpenChange: (open: boolean) => void
  loading?: boolean
  aiScoreFeedback?: AiFeedbackSentiment
  aiSummaryFeedback?: AiFeedbackSentiment
  onAiFeedback?: (target: AiFeedbackTarget, sentiment: AiFeedbackSentiment) => void
  userRating?: number
  initialComment?: string
  onRating?: (rating: number) => void
  onRatingComment?: (comment: string) => void
  refreshState?: ResumeRefreshState
  policyOverrides?: CandidatePolicyOverride[]
  resumeIdentity?: string
  onSetOverride?: (resumeId: string, resumeIdentity: string, companyKey: string, reason: string) => Promise<boolean>
  onRemoveOverride?: (resumeIdentity: string, companyKey: string) => Promise<boolean>
}

function normalizeEvidenceValue(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function matchesStructuredWorkEntry(
  companyName: string | undefined,
  jobTitle: string | undefined,
  workEntry: { companyName?: string; jobTitle?: string }
): boolean {
  const normalizedCompany = normalizeEvidenceValue(companyName)
  const normalizedJobTitle = normalizeEvidenceValue(jobTitle)
  const candidateCompany = normalizeEvidenceValue(workEntry.companyName)
  const candidateJobTitle = normalizeEvidenceValue(workEntry.jobTitle)

  const hasCompanyOnBothSides = normalizedCompany.length > 0 && candidateCompany.length > 0
  const hasTitleOnBothSides = normalizedJobTitle.length > 0 && candidateJobTitle.length > 0

  if (hasCompanyOnBothSides && normalizedCompany !== candidateCompany) {
    return false
  }

  if (hasCompanyOnBothSides && hasTitleOnBothSides) {
    return normalizedJobTitle === candidateJobTitle
  }

  if (hasCompanyOnBothSides) {
    return true
  }

  if (hasTitleOnBothSides) {
    return normalizedJobTitle === candidateJobTitle
  }

  return false
}

function shouldRenderResumeDetailWorkHistoryEntry(
  entry: ReturnType<typeof normalizeWorkHistoryEntry>,
): boolean {
  if (!entry) {
    return false
  }

  if (entry.companyName || entry.jobTitle || entry.description) {
    return true
  }

  const raw = entry.raw?.trim() ?? ''
  if (!raw) {
    return false
  }

  const normalizedRaw = raw.replace(/[\s·]+/g, '')
  if (/^[（(]?\d+(?:年(?:\d+个?月?)?|个月?|月)?[）)]?$/u.test(normalizedRaw)) {
    return false
  }

  if (/(本科|大专|中专|硕士|博士|研究生|MBA|EMBA|学校|学院|大学|学历)/u.test(raw)
    && !/(公司|经理|工程师|销售|主管|总监|主任|技术|客户|负责|部门|离职原因|CNC|数控|机械|设备|项目)/iu.test(raw)) {
    return false
  }

  const dateRange = buildWorkHistoryDateRange(entry.startDate, entry.endDate)
  if (dateRange) {
    return true
  }

  return true
}

function getConvexResumeIdForIndustryReview(
  resume: ResumeItem | ConvexResumeItem | null,
): string | undefined {
  if (!resume || typeof resume.resumeId !== 'string' || typeof (resume as ConvexResumeItem).crawledAt !== 'number') {
    return undefined
  }
  const resumeId = resume.resumeId.trim()
  return resumeId || undefined
}

export function ResumeDetail({
  resume,
  matchResult,
  open,
  onOpenChange,
  loading = false,
  aiScoreFeedback,
  aiSummaryFeedback,
  onAiFeedback,
  userRating,
  initialComment,
  onRating,
  onRatingComment,
  refreshState,
  policyOverrides,
  resumeIdentity,
  onSetOverride,
  onRemoveOverride,
}: ResumeDetailProps) {
  const { t } = useTranslation()
  const { memberships } = useAuth()
  const { slug: workspaceSlug } = useWorkspace()
  const isSystemAdmin = hasSystemAdminAccess(memberships)
  const showIndustryEvidenceReviewGuidance = isSystemAdmin || hasWorkspaceIndustryReviewAccess(memberships, workspaceSlug)
  const legacyReviewBasePath = isSystemAdmin
    ? `${SYSTEM_ROUTE_PREFIX}/settings/industry-verification`
    : `/${workspaceSlug}/system/settings/industry-verification`
  const fieldUsagePolicy = useResumeFieldUsagePolicy()
  const { limit: workHistoryLimit } = useResumeWorkHistoryLimit()
  const [isInfoExpanded, setIsInfoExpanded] = useState(false)
  const presentationResume = useMemo(
    () => (resume ? sanitizeResumeRecordForSurface(resume, 'presentation', fieldUsagePolicy) : null),
    [fieldUsagePolicy, resume],
  )
  const contentLocale = getResumeContentLocale(resume)

  const workHistory = useMemo(() => {
    if (!presentationResume?.workHistory?.length) return []
    return selectLatestWorkHistory(presentationResume.workHistory, { limit: workHistoryLimit })
      .map((entry) => normalizeWorkHistoryEntry(entry))
      .filter((entry): entry is NonNullable<typeof entry> => shouldRenderResumeDetailWorkHistoryEntry(entry))
  }, [presentationResume, workHistoryLimit])
  const verifiedIndustryEvidenceSummaries = useMemo(
    () => getVerifiedIndustryEvidenceSummaries(resume),
    [resume],
  )
  const workHistoryAnnotations = useMemo(() => {
    if (!resume || !hasIngestData(resume)) {
      return workHistory.map(() => [])
    }

    const roleSignals = resume.ingestData.roleSignals ?? []
    return workHistory.map((item) => {
      const normalizedItem = normalizeWorkHistoryEntry(item)
      const annotations = new Map<string, {
        type: string
        years: number
        approvedYears: number
        industryEvidenceProvenance: IndustryEvidenceProvenance
        approvedEntryFingerprints: Set<string>
        matchedSignals: Set<string>
      }>()

      for (const roleSignal of roleSignals) {
        for (const matchedEntry of roleSignal.matchedWorkEntries ?? []) {
          if (!matchesStructuredWorkEntry(normalizedItem?.companyName, normalizedItem?.jobTitle, matchedEntry)) {
            continue
          }

          const entryProvenance = getMatchedWorkEntryIndustryEvidenceProvenance(
            matchedEntry,
            verifiedIndustryEvidenceSummaries,
          )
          const existing = annotations.get(roleSignal.type) ?? {
            type: roleSignal.type,
            years: matchedEntry.years,
            approvedYears: 0,
            industryEvidenceProvenance: entryProvenance,
            approvedEntryFingerprints: new Set<string>(),
            matchedSignals: new Set<string>(),
          }

          existing.years = Math.max(existing.years, matchedEntry.years)
          existing.industryEvidenceProvenance = mergeIndustryEvidenceProvenance(
            existing.industryEvidenceProvenance,
            entryProvenance,
          )
          if (entryProvenance === 'approved') {
            const fingerprint = getIndustryEvidenceWorkEntryFingerprint(matchedEntry)
            if (!existing.approvedEntryFingerprints.has(fingerprint)) {
              existing.approvedEntryFingerprints.add(fingerprint)
              existing.approvedYears += matchedEntry.years
            }
          }
          matchedEntry.matchedSignals.forEach((signal) => existing.matchedSignals.add(signal))
          annotations.set(roleSignal.type, existing)
        }
      }

      return Array.from(annotations.values()).map((annotation) => ({
        type: annotation.type,
        years: annotation.industryEvidenceProvenance === 'approved' && annotation.approvedYears > 0
          ? annotation.approvedYears
          : annotation.years,
        industryEvidenceProvenance: annotation.industryEvidenceProvenance,
        matchedSignals: Array.from(annotation.matchedSignals),
      }))
    })
  }, [resume, verifiedIndustryEvidenceSummaries, workHistory])
  const hasLegacyIndustryEvidence = useMemo(() => {
    if (!showIndustryEvidenceReviewGuidance || !resume || !hasIngestData(resume)) {
      return false
    }
    return hasLegacyIndustryEvidenceInSignals(
      resume.ingestData.roleSignals,
      verifiedIndustryEvidenceSummaries,
    )
  }, [resume, showIndustryEvidenceReviewGuidance, verifiedIndustryEvidenceSummaries])
  const convexResumeIdForIndustryReview = getConvexResumeIdForIndustryReview(resume)
  const [industryReviewTarget, setIndustryReviewTarget] = useState<AvailableIndustryReviewTarget>()

  useEffect(() => {
    if (!open || !showIndustryEvidenceReviewGuidance || !hasLegacyIndustryEvidence || !convexResumeIdForIndustryReview) {
      setIndustryReviewTarget(undefined)
      return
    }

    // A previous dialog target must never be reused while a different resume
    // resolves. The generic Inbox route is safe until this exact resolver
    // returns a new authoritative proposal ID.
    setIndustryReviewTarget(undefined)
    let cancelled = false
    void rawApiClient
      .GET<ResumeIndustryReviewTargetsResponse>(
        `/api/resumes/${encodeURIComponent(convexResumeIdForIndustryReview)}/industry-review-targets`,
      )
      .then(({ data, error }) => {
        if (cancelled || error || !data?.success) return
        const directTargets = data.data.targets.filter(
          (target): target is AvailableIndustryReviewTarget => target.availability === 'target_available',
        )
        const targetsByProposalId = new Map(
          directTargets.map((target) => [target.proposalId, target] as const),
        )
        // Several legacy work entries can point to one authoritative proposal
        // (for example, a promotion at the same employer). Collapse only by
        // server-provided proposal ID; multiple distinct proposals stay generic.
        const uniqueTargets = [...targetsByProposalId.values()]
        setIndustryReviewTarget(uniqueTargets.length === 1 ? uniqueTargets[0] : undefined)
      })
      .catch(() => {
        if (!cancelled) setIndustryReviewTarget(undefined)
      })

    return () => {
      cancelled = true
    }
  }, [convexResumeIdForIndustryReview, hasLegacyIndustryEvidence, open, showIndustryEvidenceReviewGuidance])
  const { resolve: resolveBrand } = useBrandDisplayMap()
  const ingestData = resume && hasIngestData(resume) ? resume.ingestData : undefined
  const visibleIndustryTags = (ingestData?.industryTags ?? [])
    .filter((tag: string) => tag.trim().length > 0 && tag.trim().toLowerCase() !== 'unknown')
    .slice(0, 4)
  const visibleCompanyHits = (ingestData?.companyHits ?? [])
    .filter((company: string) => company.trim().length > 0)
    .slice(0, 3)
  const brandSummary = useMemo(
    () => summarizeBrandHits(ingestData?.brandHits),
    [ingestData?.brandHits],
  )
  const experienceBadge = getExperienceBadge(ingestData?.experienceLevel, t)
  const { matchResume } = useCompanyPolicyIndex(Boolean(resume))
  const companyPolicyState = useMemo(
    () =>
      getResumeCompanyPolicyState(
        {
          workHistory: presentationResume?.workHistory ?? resume?.workHistory,
          companyHits: ingestData?.companyHits,
        },
        matchResume,
        policyOverrides,
        resumeIdentity,
      ),
    [
      ingestData?.companyHits,
      matchResume,
      policyOverrides,
      presentationResume?.workHistory,
      resume?.workHistory,
      resumeIdentity,
    ],
  )
  const companyPolicyHits = companyPolicyState.hits
  const blockedCompanyHits = companyPolicyHits.filter((hit) => hit.effects.workflow === 'blocked')
  const convexResumeId = resume && typeof resume.resumeId === 'string' ? resume.resumeId : undefined
  const canManageOverrides = Boolean(convexResumeId && resumeIdentity && onSetOverride && onRemoveOverride)
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false)
  const [overrideReasonByCompany, setOverrideReasonByCompany] = useState<Record<string, string>>({})
  const [overrideBusy, setOverrideBusy] = useState(false)

  const handleGrantOverride = async (companyKey: string) => {
    if (!convexResumeId || !resumeIdentity || !onSetOverride) return
    const reason = (overrideReasonByCompany[companyKey] ?? '').trim()
    if (!reason) {
      toast.error(t('settings.policies.runtime.overrideReasonRequired'))
      return
    }
    setOverrideBusy(true)
    try {
      const ok = await onSetOverride(convexResumeId, resumeIdentity, companyKey, reason)
      if (ok) {
        toast.success(t('settings.policies.runtime.overrideSetSuccess'))
        setOverrideReasonByCompany((prev) => ({ ...prev, [companyKey]: '' }))
      } else {
        toast.error(t('settings.policies.runtime.overrideSetFailed'))
      }
    } finally {
      setOverrideBusy(false)
    }
  }

  const handleRemoveOverride = async (companyKey: string) => {
    if (!resumeIdentity || !onRemoveOverride) return
    setOverrideBusy(true)
    try {
      const ok = await onRemoveOverride(resumeIdentity, companyKey)
      if (ok) {
        toast.success(t('settings.policies.runtime.overrideRemoveSuccess'))
      } else {
        toast.error(t('settings.policies.runtime.overrideRemoveFailed'))
      }
    } finally {
      setOverrideBusy(false)
    }
  }
  const profileUrl = resume?.profileUrl?.trim()
  const hasProfileUrl = isSafeProfileUrl(profileUrl)
  const sourceLabel = getResumeSourceLabel(resume)
  const scoreLabel = matchResult
    ? t(`resumes.matching.recommendations.${matchResult.recommendation}`, {
        defaultValue: matchResult.recommendation.replace(/_/g, ' '),
      })
    : ''
  const displayBreakdown = toDisplayMatchBreakdown(matchResult?.breakdown)

  if (!resume || !presentationResume) {
    return null
  }

  const displayResume = presentationResume

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          data-testid="resume-detail-content"
        lang={contentLocale}
        className="max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-2xl overflow-y-auto p-4 sm:w-full sm:p-6 md:max-w-3xl lg:max-w-4xl"
      >
        <DialogHeader>
          <DialogTitle>{t('resumes.detail.title')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('resumes.detail.description', { defaultValue: 'Review resume details and AI analysis summary.' })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="relative pr-24 text-sm sm:pr-28">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {loading ? (
                <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700 text-[10px]">
                  {t('common.loading', 'Loading')}...
                </Badge>
              ) : null}
              {sourceLabel ? (
                <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700 text-[10px]">
                  {sourceLabel}
                </Badge>
              ) : null}
              <ResumeRefreshBadge refreshState={refreshState} />
              {visibleIndustryTags.map((tag, index) => (
                <Badge key={`it-${index}`} variant="outline" className="text-[10px] border-violet-200 bg-violet-50 text-violet-700">
                  {tag}
                </Badge>
              ))}
              {visibleCompanyHits.map((company, index) => (
                <Badge key={`ch-${index}`} variant="outline" className="text-[10px] border-blue-200 bg-blue-50 text-blue-700">
                  {resolveBrand(company)}
                </Badge>
              ))}
              {brandSummary.map((brand) => (
                <Badge key={`brand-${brand}`} variant="outline" className="text-[10px] border-amber-200 bg-amber-50 text-amber-700">
                  {resolveBrand(brand)}
                </Badge>
              ))}
              {experienceBadge ? (
                <Badge variant="outline" className={cn('text-[10px]', experienceBadge.className)}>
                  {experienceBadge.label}
                </Badge>
              ) : null}
              <CompanyPolicyBadges hits={companyPolicyHits} />
              {companyPolicyState.overriddenCompanyKeys.length > 0 ? (
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px]">
                  {t('settings.policies.runtime.overrideBadge')}
                </Badge>
              ) : null}
            </div>
            {companyPolicyHits.length > 0 ? (
              <div className="mt-2">
                <CompanyPolicyBadges hits={companyPolicyHits} variant="banner" />
              </div>
            ) : null}
            {canManageOverrides && blockedCompanyHits.length > 0 ? (
              <div className="mt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                  onClick={() => setOverrideDialogOpen(true)}
                >
                  {t('settings.policies.runtime.overrideManage')}
                </Button>
              </div>
            ) : null}
            {companyPolicyHits[0]?.companyKey ? (
              <div className="mt-2">
                <CompanyResearchStrip companyKey={companyPolicyHits[0].companyKey} />
              </div>
            ) : null}
            <div
              data-testid="resume-detail-primary-grid"
              className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4"
            >
              <div>
                <p className="text-muted-foreground">{t('resumes.columns.name')}</p>
                <p className="font-medium">{displayResume.name || '--'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t('resumes.columns.age')}</p>
                <p className="font-medium">{displayResume.age || '--'}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-0 top-0 h-9 px-2 text-muted-foreground hover:text-foreground"
              onClick={() => setIsInfoExpanded(!isInfoExpanded)}
              aria-expanded={isInfoExpanded}
              aria-controls="resume-detail-expanded-grid"
            >
              {isInfoExpanded ? t('common.collapse', 'Collapse') : t('common.expand', 'Expand')}
              {isInfoExpanded ? <ChevronUp className="h-4 w-4 ml-1" /> : <ChevronDown className="h-4 w-4 ml-1" />}
            </Button>
          </div>

          {isInfoExpanded && (
            <div
              id="resume-detail-expanded-grid"
              data-testid="resume-detail-expanded-grid"
              className="grid grid-cols-1 gap-3 border-t pt-2 text-sm sm:grid-cols-2 sm:gap-4"
            >
              <div>
                <p className="text-muted-foreground">{t('resumes.columns.experience')}</p>
                <p className="font-medium">{displayResume.experience || '--'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t('resumes.columns.education')}</p>
                <p className="font-medium">{displayResume.education || '--'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t('resumes.columns.location')}</p>
                <p className="font-medium">{displayResume.location || '--'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t('resumes.columns.salary')}</p>
                <p className="font-medium">{displayResume.expectedSalary || '--'}</p>
              </div>
              <div className="col-span-2">
                <p className="text-muted-foreground">{t('resumes.columns.intention')}</p>
                <p className="font-medium">{displayResume.jobIntention || '--'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t('resumes.columns.activity')}</p>
                <p className="font-medium">{displayResume.activityStatus || '--'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t('resumes.detail.id', { defaultValue: 'ID' })}</p>
                <p className="font-medium">
                  {[displayResume.resumeId, displayResume.perUserId].filter(Boolean).join(' / ') || '--'}
                </p>
              </div>
              {displayResume.extractedAt && (
                <div className="col-span-2">
                  <p className="text-muted-foreground">{t('resumes.detail.extractedAt')}</p>
                  <p className="font-medium">
                    {new Date(displayResume.extractedAt).toLocaleString()}
                  </p>
                </div>
              )}
              {displayResume.selfIntro && (
                <div className="col-span-2">
                  <p className="text-muted-foreground">{t('resumes.detail.selfIntro')}</p>
                  <div className="mt-1 whitespace-pre-wrap">
                    {displayResume.selfIntro}
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <p className="text-sm text-muted-foreground mb-2">{t('resumes.detail.workHistory')}</p>
            {workHistory.length === 0 ? (
              <p className="text-sm">--</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {workHistory.map((item, index) => {
                  const annotations = workHistoryAnnotations[index] ?? []
                  const dateLine = buildWorkHistoryDisplayDateLine(item)
                  const heading = [item.companyName, item.jobTitle].filter(Boolean).join(' · ')
                  const verifiedSummary = findVerifiedIndustrySummaryForCompany(
                    item.companyName,
                    verifiedIndustryEvidenceSummaries,
                    { roleSignals: resume && hasIngestData(resume) ? resume.ingestData?.roleSignals : undefined, jobTitle: item.jobTitle, rawText: item.raw },
                  )
                  return (
                    <li key={`${displayResume.name}-${index}`} className="rounded-md border border-border p-3 space-y-1">
                      {heading ? (
                        <div className="font-medium flex items-center gap-2 flex-wrap">
                          <span className="min-w-0">
                            {item.companyName ? (
                              <span className="font-medium text-slate-900">{item.companyName}</span>
                            ) : null}
                            {item.companyName && item.jobTitle ? (
                              <span className="mx-1 font-normal text-slate-400">·</span>
                            ) : null}
                            {item.jobTitle ? (
                              <span className="font-normal text-slate-600">{item.jobTitle}</span>
                            ) : null}
                          </span>
                          {verifiedSummary ? <VerifiedCompanyBadge summary={verifiedSummary} /> : null}
                        </div>
                      ) : null}
                      {dateLine ? <div className="text-xs text-muted-foreground">{dateLine}</div> : null}
                      {annotations.length > 0 ? (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {annotations.map((annotation) => (
                            <div key={`${annotation.type}-${annotation.matchedSignals.join('|')}`} className="flex flex-wrap gap-1">
                              <Badge
                                variant="outline"
                                className={annotation.industryEvidenceProvenance === 'approved' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : ''}
                              >
                                {t(`resumes.roleLabels.${annotation.type}`, { defaultValue: getRoleLabel(annotation.type) })}
                                {' '}
                                {formatRoleYears(annotation.years, contentLocale)}
                              </Badge>
                              {annotation.industryEvidenceProvenance === 'approved' ? (
                                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                                  {t('resumes.detail.industryVerified', { defaultValue: 'Industry verified' })}
                                </Badge>
                              ) : null}
                              {annotation.industryEvidenceProvenance === 'legacy' && showIndustryEvidenceReviewGuidance ? (
                                <LegacyIndustryEvidenceNotice compact />
                              ) : null}
                              {annotation.matchedSignals.map((signal) => (
                                <Badge key={`${annotation.type}-${signal}`} variant="outline" className="text-[10px]">
                                  {signal}
                                </Badge>
                              ))}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {item.description ? <div className="whitespace-pre-wrap">{item.description}</div> : null}
                      {!heading && !dateLine && !item.description ? <div>{item.raw}</div> : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {hasLegacyIndustryEvidence && showIndustryEvidenceReviewGuidance ? (
            <LegacyIndustryEvidenceNotice
              showReviewAction
              reviewTarget={industryReviewTarget}
              reviewBasePath={legacyReviewBasePath}
            />
          ) : null}

          {verifiedIndustryEvidenceSummaries.length > 0 ? (
            <IndustryEvidenceDetail
              summaries={verifiedIndustryEvidenceSummaries}
              resumeId={String(resume.resumeId ?? '') || undefined}
            />
          ) : null}

          {matchResult && (
            <div className="rounded-lg border bg-slate-50 dark:bg-slate-900 p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold flex items-center gap-2">
                  {t('resumes.detail.aiAnalysis', { defaultValue: 'AI Analysis' })}
                  <Badge className={getScoreClassName(matchResult.score)}>
                    {t('resumes.matching.scoreLabel', { score: matchResult.score })}
                  </Badge>
                  <span className="text-xs text-muted-foreground uppercase tracking-wider font-bold">
                    {scoreLabel}
                  </span>
                  {onAiFeedback ? (
                    <AiFeedbackButtons
                      feedback={aiScoreFeedback}
                      label={t('resumes.detail.aiScoreLabel', { defaultValue: 'AI score' })}
                      testId="detail-ai-score-feedback"
                      onSelect={(sentiment) => onAiFeedback('ai_score', sentiment)}
                    />
                  ) : null}
                  <StarRating value={userRating} initialComment={initialComment} onChange={onRating} onRatingComment={onRatingComment} size={14} />
                </h3>
              </div>
              {(matchResult.promptVersion != null || matchResult.locale) && (
                <div className="flex items-center gap-3 mb-3 text-[11px] text-muted-foreground">
                  {matchResult.promptVersion != null && (
                    <span>{t('resumes.detail.promptVersion', { version: matchResult.promptVersion, defaultValue: 'Prompt v{{version}}' })}</span>
                  )}
                  {matchResult.locale && (
                    <span>{t('resumes.detail.language', { defaultValue: 'Language:' })} {RESUME_AI_PROMPT_LOCALE_TO_NATURAL_LANGUAGE[matchResult.locale as keyof typeof RESUME_AI_PROMPT_LOCALE_TO_NATURAL_LANGUAGE] ?? matchResult.locale}</span>
                  )}
                </div>
              )}

              <div className="mb-3">
                <p className="text-sm text-foreground">{matchResult.summary}</p>
              </div>

              <div className={`mb-3 grid gap-4 ${matchResult.highlights?.length && matchResult.concerns?.length ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
                {matchResult.highlights && matchResult.highlights.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-green-600 mb-1">{t('resumes.detail.highlights', { defaultValue: 'Highlights' })}</h4>
                    <ul className="list-disc list-inside text-xs text-muted-foreground">
                      {matchResult.highlights.map((h, i) => <li key={i}>{h}</li>)}
                    </ul>
                  </div>
                )}
                {matchResult.concerns && matchResult.concerns.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-red-600 mb-1">{t('resumes.detail.concerns', { defaultValue: 'Concerns' })}</h4>
                    <ul className="list-disc list-inside text-xs text-muted-foreground">
                      {matchResult.concerns.map((c, i) => <li key={i}>{c}</li>)}
                    </ul>
                  </div>
                )}
              </div>

              {displayBreakdown && (
                <div className="bg-background rounded p-2 border">
                  <h4 className="text-xs font-semibold mb-2">{t('resumes.detail.detailedBreakdown', { defaultValue: 'Detailed Breakdown' })}</h4>
                  <div
                    data-testid="resume-detail-breakdown-grid"
                    className="grid grid-cols-2 gap-2 text-center md:grid-cols-3 xl:grid-cols-5"
                  >
                    {Object.entries(displayBreakdown).map(([k, v]) => (
                      <div key={k} className="flex flex-col">
                        <span className="text-[10px] text-muted-foreground uppercase truncate" title={k}>{k.replace('_', ' ')}</span>
                        <span className="text-sm font-mono font-bold">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {onAiFeedback ? (
                <div className="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-end">
                  <span className="text-xs text-muted-foreground sm:mr-3">{t('resumes.detail.summaryFeedback', { defaultValue: 'Summary Feedback' })}</span>
                  <AiFeedbackButtons
                    feedback={aiSummaryFeedback}
                    label={t('resumes.detail.aiSummaryLabel', { defaultValue: 'AI summary' })}
                    testId="detail-ai-summary-feedback"
                    onSelect={(sentiment) => onAiFeedback('ai_summary', sentiment)}
                  />
                </div>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          {hasProfileUrl ? (
            <a
              className={buttonVariants({ className: 'w-full sm:w-auto' })}
              href={profileUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t('resumes.detail.profileLink')}
            </a>
          ) : null}
          <Button variant="secondary" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>
            {t('resumes.detail.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {canManageOverrides ? (
      <Dialog open={overrideDialogOpen} onOpenChange={setOverrideDialogOpen}>
        <DialogContent
          data-testid="policy-override-dialog"
          className="max-h-[85vh] w-[calc(100vw-1.5rem)] max-w-md overflow-y-auto p-4 sm:w-full sm:p-6"
        >
          <DialogHeader>
            <DialogTitle>{t('settings.policies.runtime.overrideDialogTitle')}</DialogTitle>
            <DialogDescription>{t('settings.policies.runtime.overrideDialogDescription')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {blockedCompanyHits.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('settings.policies.runtime.overrideEmpty')}</p>
            ) : (
              blockedCompanyHits.map((hit) => {
                const companyKey = hit.companyKey
                const identity = (resumeIdentity ?? '').trim()
                const activeOverride = policyOverrides?.find(
                  (override) =>
                    override.resumeIdentity.trim() === identity && override.companyKey.trim() === companyKey,
                )
                const reason = overrideReasonByCompany[companyKey] ?? ''
                return (
                  <div key={companyKey} className="rounded border border-slate-200 p-3 dark:border-slate-800">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{resolveBrand(companyKey)}</p>
                        <p className="text-xs text-muted-foreground">
                          {activeOverride
                            ? t('settings.policies.runtime.overrideCompanyAllowed')
                            : t('settings.policies.runtime.overrideCompanyBlocked')}
                        </p>
                      </div>
                      {activeOverride ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={overrideBusy}
                          onClick={() => void handleRemoveOverride(companyKey)}
                        >
                          {t('settings.policies.runtime.overrideRemove')}
                        </Button>
                      ) : null}
                    </div>
                    {activeOverride ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {t('settings.policies.runtime.overrideAuthorizedBy', {
                          author: activeOverride.authorizedBy ?? '--',
                        })}
                        {activeOverride.reason ? ` · ${activeOverride.reason}` : ''}
                      </p>
                    ) : (
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                        <Input
                          value={reason}
                          onChange={(event) =>
                            setOverrideReasonByCompany((prev) => ({
                              ...prev,
                              [companyKey]: event.target.value,
                            }))
                          }
                          onKeyDown={(event) => {
                            if (isImeComposition(event)) {
                              return
                            }
                            if (event.key === 'Enter' && !overrideBusy && reason.trim().length > 0) {
                              event.preventDefault()
                              void handleGrantOverride(companyKey)
                            }
                          }}
                          placeholder={t('settings.policies.runtime.overrideReasonPlaceholder')}
                          className="h-9 text-xs"
                        />
                        <Button
                          type="button"
                          size="sm"
                          disabled={overrideBusy || reason.trim().length === 0}
                          onClick={() => void handleGrantOverride(companyKey)}
                        >
                          {t('settings.policies.runtime.overrideGrant')}
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOverrideDialogOpen(false)}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ) : null}
  </>
  )
}
