import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  INDUSTRY_REVIEW_ATTESTATION_SCHEMA_VERSION,
  isExplicitCncEvidenceSource,
  type IndustryReviewAttestation,
} from '@trends/shared'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useSettingsRequestJson } from '@/pages/system-settings/lib'
import { reportUiError } from '@/lib/ui-error-reporting'
import { hasWorkspaceAdminAccess, SYSTEM_ROUTE_PREFIX } from '@/lib/workspace-access'
import { IndustryAdvancedTools } from './IndustryAdvancedTools'
import { IndustryReviewInbox } from './IndustryReviewInbox'
import { EvidenceRecoveryPanel } from './EvidenceRecoveryPanel'
import {
  isTerminalIndustryProposalStatus,
  type ReviewInboxItem,
} from './industry-review-inbox-model'
import {
  createRevisionId,
  displayCompany,
  parseReviewPacket,
  type IndustryClass,
  type IndustryProposal,
  type IndustryRecomputeRun,
  type ReviewPacket,
  type ReviewQueueStatus,
  type VerificationLevel,
} from './industry-verification-model'
import { IndustryApprovedProfileLookup } from './IndustryApprovedProfileLookup'
import { IndustryCoverageHealthPanel } from './IndustryCoverageHealthPanel'
import { IndustryMaintenanceHistory } from './IndustryMaintenanceHistory'
import {
  IndustryEvidenceReviewCard,
  IndustryProposalHeaderCard,
  IndustryRecomputeCard,
  IndustryReviewRecommendationCard,
  IndustryRevisionHistoryCard,
  IndustryRiskAttestationCard,
} from './IndustryReviewDetail'

export function SystemSettingsIndustryVerificationPage() {
  const { t } = useTranslation()
  const { memberships } = useAuth()
  const { slug } = useWorkspace()
  // Ops surfaces (recompute runs, coverage health, maintenance history) are
  // admin-only; reviewers keep the review surfaces (proposals, evidence,
  // verdicts, identity resolution) below.
  const isWorkspaceAdmin = hasWorkspaceAdminAccess(memberships, slug)
  const { requestJson } = useSettingsRequestJson()
  const location = useLocation()
  const navigate = useNavigate()
  const { teamSlug, proposalId: proposalIdFromRoute } = useParams()
  // The review page renders at two bases: the canonical dev system surface
  // (/admin/system, no route param) and the workspace-scoped surface
  // (/:teamSlug/system). In-page navigation must stay on the active base —
  // hardcoding /admin/system sends workspace admins/reviewers into
  // SystemAccessGate, which bounces them to their workspace home.
  const reviewBasePath = teamSlug
    ? `/${teamSlug}/system/settings/industry-verification`
    : `${SYSTEM_ROUTE_PREFIX}/settings/industry-verification`
  const [searchParams, setSearchParams] = useSearchParams()
  const proposalIdFromPath = useMemo(() => {
    if (proposalIdFromRoute?.trim()) return proposalIdFromRoute.trim()
    const match = location.pathname.match(/\/industry-verification\/proposals\/([^/]+)/)
    if (!match?.[1]) return undefined
    try {
      return decodeURIComponent(match[1]).trim() || undefined
    } catch {
      return undefined
    }
  }, [location.pathname, proposalIdFromRoute])
  const requestedProposalId = proposalIdFromPath ?? (searchParams.get('proposalId')?.trim() || undefined)
  const [queueStatus, setQueueStatus] = useState<ReviewQueueStatus>(() => {
    const value = searchParams.get('status')
    return value === 'new' || value === 'researching' || value === 'ready_for_review' || value === 'needs_more_evidence'
      ? value
      : 'ready_for_review'
  })
  const [proposals, setProposals] = useState<IndustryProposal[]>([])
  const [directReviewPacket, setDirectReviewPacket] = useState<ReviewPacket | null>(null)
  const [directReviewError, setDirectReviewError] = useState<string>()
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([])
  const [industryClass, setIndustryClass] = useState<IndustryClass>('unknown')
  const [verificationLevel, setVerificationLevel] = useState<VerificationLevel>('verified')
  const [evidenceSummary, setEvidenceSummary] = useState('')
  const [decisionReason, setDecisionReason] = useState('')
  const [taxonomyVersion, setTaxonomyVersion] = useState('industry-v1')
  const [reviewNote, setReviewNote] = useState('')
  const [acknowledgedRiskFlags, setAcknowledgedRiskFlags] = useState<string[]>([])
  const [cncEvidenceAcknowledged, setCncEvidenceAcknowledged] = useState(false)
  const [acknowledgementReason, setAcknowledgementReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [approvalConfirmOpen, setApprovalConfirmOpen] = useState(false)
  const detailSectionRef = useRef<HTMLDivElement | null>(null)
  const userInitiatedSelectionRef = useRef(false)

  const selectedProposal = useMemo(() => {
    const packet = directReviewPacket
    return packet && packet.proposal.proposalId === requestedProposalId
      ? packet.proposal
      : undefined
  }, [directReviewPacket, requestedProposalId])
  const selectedProposalId = requestedProposalId
  const sources = directReviewPacket?.sources ?? []
  const bundle = directReviewPacket?.reviewContext ?? { profile: null, revisions: [] }
  const recomputeRuns = directReviewPacket?.recomputeRuns ?? []
  const recommendation = directReviewPacket?.recommendation ?? null
  const reviewWarnings = directReviewPacket?.warnings ?? []
  const reviewDataset = directReviewPacket?.dataset ?? null
  const research = directReviewPacket?.research ?? { featureEnabled: false, active: null, history: [] }
  const identityCandidates = directReviewPacket?.identityCandidates ?? []
  const selectedProposalIsTerminal = selectedProposal
    ? isTerminalIndustryProposalStatus(selectedProposal.status)
    : false

  const directTargetItem = useMemo<ReviewInboxItem | undefined>(() => {
    if (!directReviewPacket || directReviewPacket.proposal.proposalId !== requestedProposalId) return undefined
    return {
      proposal: directReviewPacket.proposal,
      recommendation: directReviewPacket.recommendation,
      inputFingerprint: directReviewPacket.dataset.inputFingerprint,
      sourceCount: directReviewPacket.sources.length,
      resumeImpact: 0,
    }
  }, [directReviewPacket, requestedProposalId])

  const fetchDirectReviewPacket = useCallback(async (): Promise<ReviewPacket | null> => {
    if (!requestedProposalId) {
      return null
    }
    const packetPayload = await requestJson(
      `/api/company-industry-proposals/${encodeURIComponent(requestedProposalId)}/review-packet`,
    )
    const packet = parseReviewPacket(packetPayload)
    if (!packet) throw new Error('Invalid industry review packet')
    return packet
  }, [requestJson, requestedProposalId])

  const reloadDirectReviewPacket = useCallback(async (): Promise<ReviewPacket | null> => {
    const packet = await fetchDirectReviewPacket()
    setDirectReviewPacket(packet)
    setDirectReviewError(undefined)
    return packet
  }, [fetchDirectReviewPacket])

  useEffect(() => {
    if (!requestedProposalId) {
      setDirectReviewPacket(null)
      setDirectReviewError(undefined)
      return
    }
    setDirectReviewPacket(null)
    setDirectReviewError(undefined)
    let cancelled = false
    void fetchDirectReviewPacket()
      .then((packet) => {
        if (cancelled) return
        setDirectReviewPacket(packet)
        setDirectReviewError(undefined)
      })
      .catch((error) => {
        if (cancelled) return
        reportUiError('Failed to load requested industry evidence proposal', error)
        setDirectReviewError(t('industryEvidence.targetLoadFailed', {
          defaultValue: 'The requested review target is unavailable. You can still browse the industry review inbox.',
        }))
      })
    return () => {
      cancelled = true
    }
  }, [fetchDirectReviewPacket, requestedProposalId, t])

  // Scroll the detail section into view only after a user-initiated selection
  // (row click / 查看 / Previous-Next). Initial deep links keep the inbox's own
  // targeted-row scroll behavior and must not trigger an extra page scroll.
  useEffect(() => {
    if (!userInitiatedSelectionRef.current || !selectedProposal) return
    userInitiatedSelectionRef.current = false
    // `?.` guards jsdom (no scrollIntoView) the same way the inbox does; it is
    // always defined in real browsers.
    detailSectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [selectedProposal])

  useEffect(() => {
    if (!selectedProposal || !directReviewPacket) {
      setSelectedSourceIds([])
      setApprovalConfirmOpen(false)
      return
    }
    const packet = directReviewPacket
    const nextSources = packet.sources
    const nextBundle = packet.reviewContext
    const approvalSafeSourceIds = new Set(
      packet.recommendation.sourceDecisions
        .filter((decision) => decision.approvalSafe)
        .map((decision) => decision.sourceId),
    )
    setSelectedSourceIds(
      packet.recommendation.recommendedSourceIds.length > 0
        ? packet.recommendation.recommendedSourceIds
        : nextSources
          .filter((source) => approvalSafeSourceIds.has(source.sourceId))
          .map((source) => source.sourceId),
    )
    setIndustryClass(packet.recommendation.recommendedIndustryClass ?? selectedProposal.suggestedIndustryClass ?? nextBundle.profile?.industryClass ?? 'unknown')
    setVerificationLevel(
      packet.recommendation.recommendedVerificationLevel === 'rejected' ? 'rejected' : 'verified',
    )
    setEvidenceSummary(
      packet.recommendation.evidenceSummaryDraft
      || selectedProposal.materialChangeSummary
      || nextBundle.revisions[0]?.evidenceSummary
      || '',
    )
    setDecisionReason(packet.recommendation.decisionReasonDraft)
    setReviewNote('')
    setAcknowledgedRiskFlags([])
    setCncEvidenceAcknowledged(false)
    setAcknowledgementReason('')
    setApprovalConfirmOpen(false)
  }, [directReviewPacket, selectedProposal])

  function validateApprovalInputs(): boolean {
    if (selectedProposalIsTerminal) {
      toast.error(t('industryEvidence.terminalReadOnly', { defaultValue: 'This terminal review record is read-only.' }))
      return false
    }
    if (!selectedProposal?.companyKey) {
      toast.error(t('industryEvidence.companyRequired', { defaultValue: 'Map this proposal to a canonical company first' }))
      return false
    }
    if (selectedSourceIds.length === 0 || !evidenceSummary.trim() || !decisionReason.trim()) {
      toast.error(t('industryEvidence.reviewFieldsRequired', { defaultValue: 'Select evidence and complete the review summary and reason' }))
      return false
    }
    const visibleRiskFlags = recommendation?.riskFlags ?? []
    const nonOverridableRiskFlags = recommendation?.riskDecision?.nonOverridableRiskFlags ?? []
    if (nonOverridableRiskFlags.length > 0) {
      toast.error(
        t('industryEvidence.hardRiskBlocksApproval', {
          defaultValue: 'This recommendation has a hard evidence block; request evidence or resolve the source issue first.',
        }),
      )
      return false
    }
    const allRisksAcknowledged = visibleRiskFlags.every((flag) => acknowledgedRiskFlags.includes(flag))
    if (visibleRiskFlags.length > 0 && (!allRisksAcknowledged || !acknowledgementReason.trim())) {
      toast.error(
        t('industryEvidence.riskAcknowledgementRequired', {
          defaultValue: 'Acknowledge every visible risk flag and provide a detailed reason before approving.',
        }),
      )
      return false
    }
    if (industryClass === 'cnc') {
      const explicitCncEvidence = sources.some((source) => isExplicitCncEvidenceSource(source))
      if (!explicitCncEvidence) {
        toast.error(
          t('industryEvidence.cncEvidenceRequired', {
            defaultValue: 'CNC approval requires explicit industrial evidence; keyword or discovery matches are not enough.',
          }),
        )
        return false
      }
      if (!cncEvidenceAcknowledged) {
        toast.error(
          t('industryEvidence.cncAcknowledgementRequired', {
            defaultValue: 'Confirm that you reviewed the explicit CNC evidence before approving.',
          }),
        )
        return false
      }
    }
    return true
  }

  async function approveRevision() {
    if (selectedProposalIsTerminal || !validateApprovalInputs() || !selectedProposal?.companyKey) return
    setSaving(true)
    try {
      const visibleRiskFlags = recommendation?.riskFlags ?? []
      const requiresAttestation = visibleRiskFlags.length > 0 || industryClass === 'cnc'
      const reviewAttestation: IndustryReviewAttestation | undefined = requiresAttestation
        ? {
            schemaVersion: INDUSTRY_REVIEW_ATTESTATION_SCHEMA_VERSION,
            inputFingerprint: reviewDataset?.inputFingerprint ?? '',
            decisionMode: visibleRiskFlags.length > 0 ? 'risk_override' : 'standard',
            acknowledgedRiskFlags: acknowledgedRiskFlags as IndustryReviewAttestation['acknowledgedRiskFlags'],
            cncEvidenceAcknowledged,
            acknowledgementReason: acknowledgementReason.trim(),
          }
        : undefined
      await requestJson(
        `/api/company-industry-proposals/${encodeURIComponent(selectedProposal.proposalId)}/approve`,
        {
          method: 'POST',
          body: JSON.stringify({
            revisionId: createRevisionId(selectedProposal.companyKey),
            expectedCurrentRevisionId: bundle.profile?.currentRevisionId,
            expectedProposalUpdatedAt: reviewDataset?.proposalUpdatedAt ?? selectedProposal.updatedAt,
            expectedInputFingerprint: reviewDataset?.inputFingerprint,
            expectedSourceVersions: reviewDataset?.sourceVersions,
            ...(reviewAttestation ? { reviewAttestation } : {}),
            verificationLevel,
            industryClass,
            approvedSourceIds: selectedSourceIds,
            evidenceSummary: evidenceSummary.trim(),
            decisionReason: decisionReason.trim(),
            taxonomyVersion: taxonomyVersion.trim(),
          }),
        },
      )
      toast.success(t('industryEvidence.approved', { defaultValue: 'Industry verdict revision approved' }))
      setApprovalConfirmOpen(false)
      await reloadDirectReviewPacket()
    } catch (error) {
      reportUiError('Failed to approve industry verdict revision', error)
      toast.error(
        error instanceof Error && error.message.includes('409')
          ? 'Review packet is stale. Refresh before approving.'
          : t('industryEvidence.approvalFailed', { defaultValue: 'Failed to approve industry verdict revision' }),
      )
    } finally {
      setSaving(false)
    }
  }

  async function resolveProposal(resolution: 'rejected' | 'needs_more_evidence') {
    if (!selectedProposal || selectedProposalIsTerminal) return
    setSaving(true)
    try {
      await requestJson(
        `/api/company-industry-proposals/${encodeURIComponent(selectedProposal.proposalId)}/resolve`,
        {
          method: 'POST',
          body: JSON.stringify({
            resolution,
            expectedProposalUpdatedAt: reviewDataset?.proposalUpdatedAt ?? selectedProposal.updatedAt,
            reviewNote: reviewNote.trim() || (
              resolution === 'needs_more_evidence'
                ? 'Reviewer requested additional evidence.'
                : 'Reviewer rejected the proposed change.'
            ),
          }),
        },
      )
      toast.success(
        resolution === 'needs_more_evidence'
          ? t('industryEvidence.moreEvidenceRequested', { defaultValue: 'Additional evidence requested; current truth is unchanged' })
          : t('industryEvidence.proposalRejected', { defaultValue: 'Proposal rejected; current truth is unchanged' }),
      )
      await reloadDirectReviewPacket()
    } catch (error) {
      reportUiError('Failed to resolve industry evidence proposal', error)
      toast.error(
        error instanceof Error && error.message.includes('409')
          ? 'Review packet is stale. Refresh before resolving.'
          : t('industryEvidence.resolveFailed', { defaultValue: 'Failed to update proposal' }),
      )
    } finally {
      setSaving(false)
    }
  }

  function prepareApproval() {
    if (selectedProposalIsTerminal || !validateApprovalInputs()) return
    setApprovalConfirmOpen(true)
  }

  function selectProposal(proposalId: string | undefined) {
    userInitiatedSelectionRef.current = true
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('proposalId')
    nextParams.delete('status')
    navigate({
      pathname: proposalId
        ? `${reviewBasePath}/proposals/${encodeURIComponent(proposalId)}`
        : reviewBasePath,
      search: nextParams.toString() ? `?${nextParams.toString()}` : '',
    }, { replace: true })
  }

  function changeQueueStatus(status: ReviewQueueStatus) {
    setQueueStatus(status)
    const nextParams = new URLSearchParams(searchParams)
    if (requestedProposalId) nextParams.delete('status')
    else nextParams.set('status', status)
    setSearchParams(nextParams, { replace: true })
  }

  function moveSelection(direction: -1 | 1) {
    if (proposals.length === 0) return
    const currentIndex = proposals.findIndex((proposal) => proposal.proposalId === selectedProposalId)
    const nextIndex = currentIndex < 0
      ? 0
      : (currentIndex + direction + proposals.length) % proposals.length
    selectProposal(proposals[nextIndex]?.proposalId)
  }

  async function updateRecompute(run: IndustryRecomputeRun, action: 'advance' | 'retry') {
    setSaving(true)
    try {
      await requestJson(
        `/api/company-industry-recompute-runs/${encodeURIComponent(run.runId)}/${action}`,
        { method: 'POST' },
      )
      await reloadDirectReviewPacket()
    } catch (error) {
      reportUiError(`Failed to ${action} industry recompute`, error)
      toast.error(t('industryEvidence.recomputeFailed', { defaultValue: 'Failed to update targeted recompute' }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">
            {t('industryEvidence.settingsTitle', { defaultValue: 'Industry verification' })}
          </h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {t('industryEvidence.settingsDescription', {
              defaultValue: 'Review external evidence proposals, approve immutable verdict revisions, and monitor the evidence used by 行业验证.',
            })}
          </p>
        </div>
      </div>

      <IndustryReviewInbox
        requestJson={requestJson}
        initialStatus={queueStatus}
        requestedProposalId={requestedProposalId}
        selectedProposalId={selectedProposalId}
        targetItem={directTargetItem}
        targetError={directReviewError}
        targetPending={Boolean(requestedProposalId && !directReviewPacket && !directReviewError)}
        onQueueStatusChange={changeQueueStatus}
        onSelectProposal={(proposal) => selectProposal(proposal?.proposalId)}
        onLoadedProposalsChange={setProposals}
      />

      <div className="space-y-6">
        <div className="space-y-6" ref={detailSectionRef} data-testid="industry-review-detail-section">
          {!selectedProposal ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                {t('industryEvidence.selectProposal', { defaultValue: 'Select a proposal to review its evidence.' })}
              </CardContent>
            </Card>
          ) : (
            <>
              <IndustryProposalHeaderCard
                proposal={selectedProposal}
                profile={bundle.profile}
                saving={saving}
                canMove={proposals.length >= 2}
                onPrevious={() => moveSelection(-1)}
                onNext={() => moveSelection(1)}
              />

              <EvidenceRecoveryPanel
                proposalId={selectedProposal.proposalId}
                proposalUpdatedAt={reviewDataset?.proposalUpdatedAt ?? selectedProposal.updatedAt}
                companyKey={selectedProposal.companyKey}
                employerSurface={selectedProposal.normalizedEmployerSurface}
                research={research}
                identityCandidates={identityCandidates}
                requestJson={requestJson}
                onReload={async () => { await reloadDirectReviewPacket() }}
                disabled={selectedProposalIsTerminal}
              />

              <IndustryReviewRecommendationCard
                recommendation={recommendation}
                warnings={reviewWarnings}
                dataset={reviewDataset}
              />

              {!selectedProposalIsTerminal && recommendation && (recommendation.riskDecision?.requiresAcknowledgement || industryClass === 'cnc') && (
                <IndustryRiskAttestationCard
                  recommendation={recommendation}
                  sources={sources}
                  cncMode={industryClass === 'cnc'}
                  acknowledgedRiskFlags={acknowledgedRiskFlags}
                  onToggleRiskFlag={(flag, checked) => setAcknowledgedRiskFlags((current) => checked
                    ? [...new Set([...current, flag])]
                    : current.filter((item) => item !== flag))}
                  cncEvidenceAcknowledged={cncEvidenceAcknowledged}
                  onCncEvidenceAcknowledgedChange={setCncEvidenceAcknowledged}
                  acknowledgementReason={acknowledgementReason}
                  onAcknowledgementReasonChange={setAcknowledgementReason}
                />
              )}

              {isWorkspaceAdmin && (
                <IndustryRecomputeCard
                  runs={recomputeRuns}
                  saving={saving}
                  onAdvance={(run) => void updateRecompute(run, 'advance')}
                  onRetry={(run) => void updateRecompute(run, 'retry')}
                />
              )}

              <IndustryEvidenceReviewCard
                sources={sources}
                recommendation={recommendation}
                selectedSourceIds={selectedSourceIds}
                onToggleSource={(sourceId, checked) => setSelectedSourceIds((current) => checked
                  ? [...new Set([...current, sourceId])]
                  : current.filter((id) => id !== sourceId))}
                readOnly={selectedProposalIsTerminal}
              />

              <Card>
                <CardHeader>
                  <CardTitle>{t('industryEvidence.reviewDecision', { defaultValue: 'Review decision' })}</CardTitle>
                  <CardDescription>
                    {t('industryEvidence.reviewDecisionDescription', {
                      defaultValue: 'Approval creates a new immutable revision and advances the current profile atomically.',
                    })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {selectedProposalIsTerminal ? (
                    <p className="rounded-md border border-muted bg-muted/30 p-3 text-sm text-muted-foreground" data-testid="industry-review-terminal-read-only">
                      This proposal is in terminal history. Its evidence and immutable revision history are read-only.
                    </p>
                  ) : null}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2 text-sm font-medium">
                      Verdict {recommendation && <span className="text-xs font-normal text-muted-foreground">(Suggested)</span>}
                      <select
                        name="verificationLevel"
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
                        value={verificationLevel}
                        onChange={(event) => setVerificationLevel(event.target.value as VerificationLevel)}
                        disabled={selectedProposalIsTerminal}
                      >
                        <option value="verified">verified</option>
                        <option value="rejected">rejected</option>
                      </select>
                    </label>
                    <label className="space-y-2 text-sm font-medium">
                      Industry class {recommendation && <span className="text-xs font-normal text-muted-foreground">(Suggested)</span>}
                      <select
                        name="industryClass"
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
                        value={industryClass}
                        onChange={(event) => setIndustryClass(event.target.value as IndustryClass)}
                        disabled={selectedProposalIsTerminal}
                      >
                        {['cnc', 'automation', 'metrology', 'industrial', 'non_industry', 'unknown'].map((value) => (
                          <option key={value} value={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="block space-y-2 text-sm font-medium">
                    Evidence summary {recommendation && <span className="text-xs font-normal text-muted-foreground">(Suggested)</span>}
                    <Input
                      name="evidenceSummary"
                      autoComplete="off"
                      aria-label="Evidence summary"
                      value={evidenceSummary}
                      onChange={(event) => setEvidenceSummary(event.target.value)}
                      disabled={selectedProposalIsTerminal}
                    />
                  </label>
                  <label className="block space-y-2 text-sm font-medium">
                    Decision reason {recommendation && <span className="text-xs font-normal text-muted-foreground">(Suggested)</span>}
                    <Input
                      name="decisionReason"
                      autoComplete="off"
                      aria-label="Decision reason"
                      value={decisionReason}
                      onChange={(event) => setDecisionReason(event.target.value)}
                      disabled={selectedProposalIsTerminal}
                    />
                  </label>
                  {approvalConfirmOpen && (
                    <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-4 text-sm" data-testid="industry-review-approval-confirmation">
                      <p className="font-medium">Confirm this immutable revision</p>
                      <p>
                        You are approving <strong>{industryClass}</strong> as <strong>{verificationLevel}</strong> for{' '}
                        <strong>{displayCompany(selectedProposal.companyKey ?? selectedProposal.normalizedEmployerSurface)}</strong>.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Sources: {selectedSourceIds.join(', ')} · this will create a new revision and start targeted recompute.
                      </p>
                      {recommendation && recommendation.riskFlags.length > 0 && (
                        <p className="text-xs font-medium text-amber-900">
                          Review flags remain: {recommendation.riskFlags.join(', ')}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button onClick={() => void approveRevision()} disabled={saving || selectedProposalIsTerminal}>
                          Confirm approve revision
                        </Button>
                        <Button variant="outline" onClick={() => setApprovalConfirmOpen(false)} disabled={saving}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                  <label className="block space-y-2 text-sm font-medium">
                    Taxonomy version
                    <Input
                      name="taxonomyVersion"
                      autoComplete="off"
                      aria-label="Taxonomy version"
                      value={taxonomyVersion}
                      onChange={(event) => setTaxonomyVersion(event.target.value)}
                      disabled={selectedProposalIsTerminal}
                    />
                  </label>
                  <label className="block space-y-2 text-sm font-medium">
                    Review note (for reject / more evidence)
                    <Input
                      name="reviewNote"
                      autoComplete="off"
                      aria-label="Review note"
                      value={reviewNote}
                      onChange={(event) => setReviewNote(event.target.value)}
                      disabled={selectedProposalIsTerminal}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={prepareApproval}
                      disabled={selectedProposalIsTerminal || saving || approvalConfirmOpen || (recommendation?.riskDecision?.nonOverridableRiskFlags.length ?? 0) > 0}
                    >
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      Approve revision
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void resolveProposal('needs_more_evidence')}
                      disabled={selectedProposalIsTerminal || saving}
                    >
                      Request more evidence
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => void resolveProposal('rejected')}
                      disabled={selectedProposalIsTerminal || saving}
                    >
                      Reject proposal
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    “Request more evidence” records the human review disposition only. Use “Research &amp; verify employer” above to queue the guarded worker.
                  </p>
                </CardContent>
              </Card>

              <IndustryRevisionHistoryCard revisions={bundle.revisions} />
            </>
          )}
        </div>
      </div>

      <IndustryAdvancedTools>
        {isWorkspaceAdmin && <IndustryCoverageHealthPanel requestJson={requestJson} />}
        <IndustryApprovedProfileLookup requestJson={requestJson} />
        {isWorkspaceAdmin && <IndustryMaintenanceHistory requestJson={requestJson} />}
      </IndustryAdvancedTools>

    </div>
  )
}
