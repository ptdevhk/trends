import { useEffect, useState } from 'react'
import { Loader2, RefreshCw, SearchCheck, ShieldAlert, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { paths } from '@/lib/api-types'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

type ReviewPacketResponse = paths['/api/company-industry-proposals/:proposalId/review-packet']['get']['responses'][200]['content']['application/json']
type ResearchSummary = ReviewPacketResponse['research']
type IdentityCandidate = ReviewPacketResponse['identityCandidates'][number]
type RegistryCompany = { companyKey: string; displayName: string; status?: string }

type RequestJson = (path: string, init?: RequestInit) => Promise<unknown>

interface EvidenceRecoveryPanelProps {
  proposalId: string
  proposalUpdatedAt: number
  companyKey?: string
  employerSurface?: string
  research: ResearchSummary
  identityCandidates: IdentityCandidate[]
  requestJson: RequestJson
  onReload: () => Promise<unknown>
  disabled?: boolean
}

function stateLabel(
  state: string | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const labels: Record<string, [string, string]> = {
    queued: ['industryEvidence.recoveryStateQueued', 'Queued'],
    leased: ['industryEvidence.recoveryStateResearching', 'Researching now'],
    retry_wait: ['industryEvidence.recoveryStateRetry', 'Waiting to retry'],
    needs_identity_review: ['industryEvidence.recoveryStateIdentity', 'Identity review needed'],
    needs_more_evidence: ['industryEvidence.recoveryStateMoreEvidence', 'More evidence needed'],
    completed: ['industryEvidence.recoveryStateReady', 'Evidence ready for review'],
    failed: ['industryEvidence.recoveryStateFailed', 'Research failed'],
    cancelled: ['industryEvidence.recoveryStateCancelled', 'Cancelled'],
  }
  const [key, fallback] = labels[state ?? ''] ?? ['industryEvidence.recoveryStateNotRequested', 'Not requested']
  return t(key, { defaultValue: fallback })
}

function candidateAlias(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function EvidenceRecoveryPanel({
  proposalId,
  proposalUpdatedAt,
  companyKey,
  employerSurface,
  research,
  identityCandidates,
  requestJson,
  onReload,
  disabled = false,
}: EvidenceRecoveryPanelProps) {
  const { t } = useTranslation()
  const [requesting, setRequesting] = useState(false)
  const [mapping, setMapping] = useState(false)
  const [selectedCandidate, setSelectedCandidate] = useState<IdentityCandidate>()
  const [existingCompanyKey, setExistingCompanyKey] = useState('')
  const [registryCompanies, setRegistryCompanies] = useState<RegistryCompany[]>([])
  const [identityReviewNote, setIdentityReviewNote] = useState('')

  const active = research.active
  const latestRequest = active ?? research.history[0]
  const canRequest = research.featureEnabled && !disabled && !requesting && !active
  const candidate = selectedCandidate
    ? identityCandidates.find((item) => item.candidateFingerprint === selectedCandidate.candidateFingerprint)
    : undefined

  useEffect(() => {
    setSelectedCandidate((current) => {
      if (!current) return undefined
      return identityCandidates.find((item) => item.candidateFingerprint === current.candidateFingerprint)
    })
  }, [identityCandidates, proposalId])

  useEffect(() => {
    setSelectedCandidate(undefined)
    setExistingCompanyKey('')
    setIdentityReviewNote('')
  }, [proposalId])

  useEffect(() => {
    if (companyKey || identityCandidates.length === 0 || disabled) return
    let cancelled = false
    void requestJson('/api/companies')
      .then((payload) => {
        if (cancelled) return
        const value = payload as { items?: unknown }
        if (!Array.isArray(value.items)) return
        setRegistryCompanies(value.items.filter((item): item is RegistryCompany => (
          typeof item === 'object' && item !== null
          && typeof (item as RegistryCompany).companyKey === 'string'
          && typeof (item as RegistryCompany).displayName === 'string'
          && (item as RegistryCompany).status !== 'merged'
        )))
      })
      .catch(() => {
        // The provisional path remains available if the registry is degraded.
      })
    return () => { cancelled = true }
  }, [companyKey, disabled, identityCandidates.length, requestJson])

  async function queueResearch() {
    if (!canRequest) return
    setRequesting(true)
    try {
      await requestJson(`/api/company-industry-proposals/${encodeURIComponent(proposalId)}/research-requests`, {
        method: 'POST',
        body: JSON.stringify({ origin: 'admin_review' }),
      })
      toast.success(t('industryEvidence.recoveryQueueSuccess', { defaultValue: 'Targeted employer research queued' }))
      await onReload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('industryEvidence.recoveryQueueError', { defaultValue: 'Unable to queue targeted research' }))
    } finally {
      setRequesting(false)
    }
  }

  async function retryRequest() {
    if (!active?.canRetry || disabled) return
    setRequesting(true)
    try {
      await requestJson(`/api/company-industry-proposals/${encodeURIComponent(proposalId)}/research-requests/${encodeURIComponent(active.requestId)}/retry`, { method: 'POST' })
      toast.success(t('industryEvidence.recoveryRetrySuccess', { defaultValue: 'Research request returned to the queue' }))
      await onReload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('industryEvidence.recoveryRetryError', { defaultValue: 'Unable to retry research' }))
    } finally {
      setRequesting(false)
    }
  }

  async function cancelRequest() {
    if (!active?.canCancel || disabled) return
    setRequesting(true)
    try {
      await requestJson(`/api/company-industry-proposals/${encodeURIComponent(proposalId)}/research-requests/${encodeURIComponent(active.requestId)}/cancel`, { method: 'POST' })
      toast.success(t('industryEvidence.recoveryCancelSuccess', { defaultValue: 'Research request cancelled' }))
      await onReload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('industryEvidence.recoveryCancelError', { defaultValue: 'Unable to cancel research' }))
    } finally {
      setRequesting(false)
    }
  }

  async function resolveIdentity(mappingMode: 'existing' | 'create_provisional') {
    if (!candidate || disabled || mapping) return
    if (mappingMode === 'existing' && !existingCompanyKey.trim()) {
      toast.error(t('industryEvidence.recoveryCompanyRequired', { defaultValue: 'Enter the canonical company key to map' }))
      return
    }
    setMapping(true)
    try {
      await requestJson(`/api/company-industry-proposals/${encodeURIComponent(proposalId)}/identity-resolution`, {
        method: 'POST',
        body: JSON.stringify({
          expectedProposalUpdatedAt: proposalUpdatedAt,
          candidateFingerprint: candidate.candidateFingerprint,
          mappingMode,
          ...(mappingMode === 'existing' ? { companyKey: existingCompanyKey.trim() } : {
            provisionalDisplayName: candidate.normalizedLegalName,
            provisionalAlias: candidateAlias(candidate.normalizedLegalName),
          }),
          sourceIds: candidate.sourceIds,
          reviewNote: identityReviewNote.trim() || 'Identity mapping reviewed from the targeted evidence panel.',
        }),
      })
      toast.success(t('industryEvidence.recoveryMappingSuccess', { defaultValue: 'Employer identity mapping recorded; approval remains a separate review step' }))
      setSelectedCandidate(undefined)
      await onReload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('industryEvidence.recoveryMappingError', { defaultValue: 'Unable to resolve employer identity' }))
    } finally {
      setMapping(false)
    }
  }

  return (
    <Card data-testid="industry-evidence-recovery-panel" className="border-primary/30">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <SearchCheck className="h-5 w-5 text-primary" aria-hidden="true" />
              {t('industryEvidence.recoveryTitle', { defaultValue: 'Evidence recovery & identity review' })}
            </CardTitle>
            <CardDescription>
              {t('industryEvidence.recoveryDescription', { defaultValue: 'Research can add durable evidence and identity candidates. It never approves a verdict or silently maps an employer.' })}
            </CardDescription>
          </div>
          <Badge variant={active ? 'secondary' : 'outline'}>{stateLabel(latestRequest?.state, t)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border p-3">
            <p className="font-medium">{t('industryEvidence.recoveryEmployerStep', { defaultValue: '1. Exact employer target' })}</p>
            <p className="mt-1 text-muted-foreground">{companyKey ? t('industryEvidence.recoveryMappedTo', { defaultValue: 'Mapped to {{companyKey}}', companyKey }) : employerSurface ?? t('industryEvidence.recoveryEmployerUnavailable', { defaultValue: 'Employer surface unavailable' })}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="font-medium">{t('industryEvidence.recoveryEvidenceStep', { defaultValue: '2. Durable evidence' })}</p>
            <p className="mt-1 text-muted-foreground">{latestRequest ? stateLabel(latestRequest.state, t) : t('industryEvidence.recoveryNoRequest', { defaultValue: 'No targeted request yet' })}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="font-medium">{t('industryEvidence.recoveryClaimStep', { defaultValue: '3. Human CNC claim' })}</p>
            <p className="mt-1 text-muted-foreground">{t('industryEvidence.recoveryClaimBody', { defaultValue: 'Approval remains below, after evidence and identity are reviewed.' })}</p>
          </div>
        </div>

        {!research.featureEnabled && (
          <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>{t('industryEvidence.recoveryDisabled', { defaultValue: 'Targeted research is disabled in this environment. An operator must enable the guarded feature flag before this proposal can be re-collected.' })}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void queueResearch()} disabled={!canRequest} data-testid="queue-industry-evidence-research">
            {requesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <SearchCheck className="mr-2 h-4 w-4" aria-hidden="true" />}
            {active ? t('industryEvidence.recoveryActive', { defaultValue: 'Research request active' }) : t('industryEvidence.recoveryQueueButton', { defaultValue: 'Research & verify employer' })}
          </Button>
          {active?.canRetry && (
            <Button variant="outline" onClick={() => void retryRequest()} disabled={requesting || disabled}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> {t('industryEvidence.recoveryRetry', { defaultValue: 'Retry' })}
            </Button>
          )}
          {active?.canCancel && (
            <Button variant="ghost" onClick={() => void cancelRequest()} disabled={requesting || disabled}>
              <XCircle className="mr-2 h-4 w-4" aria-hidden="true" /> {t('industryEvidence.recoveryCancel', { defaultValue: 'Cancel request' })}
            </Button>
          )}
        </div>
        {latestRequest?.lastOutcome && <p className="text-xs text-muted-foreground">{t('industryEvidence.recoveryWorkerNote', { defaultValue: 'Latest worker note: {{outcome}}', outcome: latestRequest.lastOutcome })}</p>}

        {identityCandidates.length > 0 && !companyKey && (
          <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/50 p-4">
            <div>
              <p className="font-medium">{t('industryEvidence.recoveryIdentityTitle', { defaultValue: 'Potential legal identity — human review required' })}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('industryEvidence.recoveryIdentityDescription', { defaultValue: 'These names came from fetched proposal evidence. Select a candidate, then map it to an existing registry row or create a provisional row. This does not approve the industry claim.' })}</p>
            </div>
            <div role="group" aria-label={t('common.potentialLegalIdentitiesAria', { defaultValue: 'Potential legal identities' })} className="space-y-2">
            {identityCandidates.map((item) => (
              <button
                key={item.candidateFingerprint}
                type="button"
                aria-pressed={candidate?.candidateFingerprint === item.candidateFingerprint}
                className={`w-full rounded-md border bg-background p-3 text-left ${candidate?.candidateFingerprint === item.candidateFingerprint ? 'border-primary ring-2 ring-primary/20' : ''}`}
                onClick={() => setSelectedCandidate(item)}
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{item.normalizedLegalName}</span>
                  <Badge variant="outline">{Math.round(item.confidence * 100)}% confidence</Badge>
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{t('industryEvidence.recoverySourceCount', { defaultValue: '{{count}} fetched source(s) · {{jurisdiction}}', count: item.sourceIds.length, jurisdiction: item.jurisdiction ?? t('industryEvidence.recoveryJurisdictionUnknown', { defaultValue: 'jurisdiction unknown' }) })}</span>
              </button>
            ))}
            </div>
            {candidate && (
              <div className="space-y-2 border-t pt-3">
                <label className="block space-y-1 font-medium">
                  {t('industryEvidence.recoveryRegistryLabel', { defaultValue: 'Existing canonical company (optional)' })}
                  <select
                    value={existingCompanyKey}
                    onChange={(event) => setExistingCompanyKey(event.target.value)}
                    disabled={mapping || registryCompanies.length === 0}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    aria-label={t('common.existingCanonicalCompanyAria', { defaultValue: 'Existing canonical company' })}
                  >
                    <option value="">{t('industryEvidence.recoveryRegistryPlaceholder', { defaultValue: 'Choose a registry company' })}</option>
                    {registryCompanies.map((item) => (
                      <option key={item.companyKey} value={item.companyKey}>{item.displayName} · {item.companyKey}</option>
                    ))}
                  </select>
                  {registryCompanies.length === 0 && <span className="text-xs font-normal text-muted-foreground">{t('industryEvidence.recoveryRegistryEmpty', { defaultValue: 'No registry choices loaded; use the provisional identity action or refresh the packet.' })}</span>}
                </label>
                <label className="block space-y-1 font-medium">
                  {t('industryEvidence.recoveryReviewNote', { defaultValue: 'Review note (recommended)' })}
                  <Input value={identityReviewNote} onChange={(event) => setIdentityReviewNote(event.target.value)} placeholder={t('industryEvidence.recoveryReviewNotePlaceholder', { defaultValue: 'Explain why this legal name matches the employer.' })} disabled={mapping} />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void resolveIdentity('existing')} disabled={mapping || !existingCompanyKey.trim()}>
                    {mapping ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                    {t('industryEvidence.recoveryMapExisting', { defaultValue: 'Map to existing company' })}
                  </Button>
                  <Button variant="outline" onClick={() => void resolveIdentity('create_provisional')} disabled={mapping}>
                    {t('industryEvidence.recoveryCreateProvisional', { defaultValue: 'Create provisional identity' })}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
        {research.history.length > 0 && (
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer font-medium">{t('industryEvidence.recoveryHistory', { defaultValue: 'Request history ({{count}})', count: research.history.length })}</summary>
            <div className="mt-2 space-y-2 text-xs text-muted-foreground">
              {research.history.map((item) => (
                <div key={item.requestId} className="flex flex-wrap justify-between gap-2">
                  <span>{stateLabel(item.state, t)} · {item.origin.replace(/_/g, ' ')}</span>
                  <span>{t('industryEvidence.recoveryAttempts', { defaultValue: '{{count}} attempt(s)', count: item.attemptCount })}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  )
}
