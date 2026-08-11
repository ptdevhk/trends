import { useEffect, useMemo, useState } from 'react'
import { Building2, ContactRound, IdCard, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { paths } from '@/lib/api-types'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { ReviewInboxItem } from './industry-review-inbox-model'

type ReviewPacketResponse = paths['/api/company-industry-proposals/:proposalId/review-packet']['get']['responses'][200]['content']['application/json']

export type IdentityCandidate = ReviewPacketResponse['identityCandidates'][number]

export type RegistryCompany = {
  companyKey: string
  displayName: string
  status?: string
  nameEn?: string
  nameCn?: string
}

export type IdentityDialogPacket = {
  candidates: IdentityCandidate[]
  proposalUpdatedAt: number
}

export type IdentityResolutionAction = {
  proposalId: string
  expectedProposalUpdatedAt: number
  candidateFingerprint: string
  mappingMode: 'existing' | 'create_provisional'
  companyKey?: string
  provisionalDisplayName?: string
  provisionalAlias?: string
  sourceIds: string[]
  reviewNote?: string
}

type ItemSelection = {
  candidateFingerprint: string
  mappingMode: 'create_provisional' | 'existing'
  companyKey?: string
  displayName: string
  alias: string
}

type IndustryIdentityResolutionDialogProps = {
  open: boolean
  items: ReviewInboxItem[]
  packets: ReadonlyMap<string, IdentityDialogPacket>
  companies: RegistryCompany[]
  companiesLoading: boolean
  submitting: boolean
  onSubmit: (actions: IdentityResolutionAction[]) => void
  onOpenChange: (open: boolean) => void
}

function companyLabel(value: string | undefined): string {
  if (!value) return 'Unresolved employer'
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((token) => token.toUpperCase())
    .join(' ')
}

export function pickBestIdentityCandidate(candidates: readonly IdentityCandidate[]): IdentityCandidate | undefined {
  return [...candidates]
    .filter((candidate) => candidate.reviewState !== 'rejected')
    .sort((a, b) => b.confidence - a.confidence)[0]
}

function defaultSelection(candidates: readonly IdentityCandidate[]): ItemSelection | undefined {
  const best = pickBestIdentityCandidate(candidates)
  if (!best) return undefined
  return {
    candidateFingerprint: best.candidateFingerprint,
    mappingMode: 'create_provisional',
    displayName: best.normalizedLegalName,
    alias: '',
  }
}

function candidateSummary(candidate: IdentityCandidate): string {
  const parts: string[] = []
  if (candidate.jurisdiction) parts.push(candidate.jurisdiction)
  if (candidate.registrationNumber) parts.push(candidate.registrationNumber)
  return parts.join(' · ')
}

export function IndustryIdentityResolutionDialog({
  open,
  items,
  packets,
  companies,
  companiesLoading,
  submitting,
  onSubmit,
  onOpenChange,
}: IndustryIdentityResolutionDialogProps) {
  const { t } = useTranslation()
  const [selections, setSelections] = useState<Record<string, ItemSelection>>({})
  const [reviewNote, setReviewNote] = useState('')
  const [registryFilter, setRegistryFilter] = useState('')

  useEffect(() => {
    if (!open) return
    const next: Record<string, ItemSelection> = {}
    for (const item of items) {
      const candidates = packets.get(item.proposal.proposalId)?.candidates ?? []
      const fallback = defaultSelection(candidates)
      if (fallback) next[item.proposal.proposalId] = fallback
    }
    setSelections(next)
    setReviewNote('')
    setRegistryFilter('')
  }, [open, items, packets])

  const resolvableItems = useMemo(
    () => items.filter((item) => (packets.get(item.proposal.proposalId)?.candidates.length ?? 0) > 0),
    [items, packets],
  )
  const excludedItems = useMemo(
    () => items.filter((item) => (packets.get(item.proposal.proposalId)?.candidates.length ?? 0) === 0),
    [items, packets],
  )

  const filteredCompanies = useMemo(() => {
    const needle = registryFilter.trim().toLowerCase()
    if (!needle) return companies
    return companies.filter((company) =>
      [company.displayName, company.companyKey, company.nameEn, company.nameCn]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    )
  }, [companies, registryFilter])

  const invalidItems = useMemo(() => {
    const invalid: Array<{ proposalId: string; reason: 'candidate' | 'company' }> = []
    for (const item of resolvableItems) {
      const selection = selections[item.proposal.proposalId]
      if (!selection) {
        invalid.push({ proposalId: item.proposal.proposalId, reason: 'candidate' })
        continue
      }
      if (selection.mappingMode === 'existing' && !selection.companyKey?.trim()) {
        invalid.push({ proposalId: item.proposal.proposalId, reason: 'company' })
      }
    }
    return invalid
  }, [resolvableItems, selections])

  const canSubmit = resolvableItems.length > 0 && invalidItems.length === 0 && !submitting

  function setSelection(proposalId: string, patch: Partial<ItemSelection>): void {
    setSelections((current) => {
      const existing = current[proposalId]
      if (!existing) return current
      return { ...current, [proposalId]: { ...existing, ...patch } }
    })
  }

  function handleSubmit(): void {
    if (!canSubmit) return
    const actions: IdentityResolutionAction[] = []
    for (const item of resolvableItems) {
      const selection = selections[item.proposal.proposalId]
      const packet = packets.get(item.proposal.proposalId)
      const candidate = packet?.candidates.find(
        (candidate) => candidate.candidateFingerprint === selection?.candidateFingerprint,
      )
      if (!selection || !candidate) continue
      actions.push({
        proposalId: item.proposal.proposalId,
        expectedProposalUpdatedAt: packet?.proposalUpdatedAt ?? item.proposal.updatedAt,
        candidateFingerprint: selection.candidateFingerprint,
        mappingMode: selection.mappingMode,
        ...(selection.mappingMode === 'existing'
          ? { companyKey: (selection.companyKey ?? '').trim() }
          : {
              provisionalDisplayName: selection.displayName.trim() || candidate.normalizedLegalName,
              ...(selection.alias.trim() ? { provisionalAlias: selection.alias.trim() } : {}),
            }),
        sourceIds: candidate.sourceIds,
        reviewNote: reviewNote.trim() || t('industryEvidence.identityDefaultNote', {
          defaultValue: 'Identity mapping reviewed from the batch review lane.',
        }),
      })
    }
    if (actions.length === 0) return
    onSubmit(actions)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {t('industryEvidence.identityResolveTitle', { defaultValue: 'Resolve employer identities' })}
          </DialogTitle>
          <DialogDescription>
            {t('industryEvidence.identityResolveDescription', {
              defaultValue: 'Map each proposal to a canonical company so the missing-mapping flag clears and batch approval can proceed. This does not approve the industry claim.',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {excludedItems.length > 0 ? (
            <div
              className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
              data-testid="industry-identity-excluded"
            >
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium">
                  {t('industryEvidence.identityNoCandidatesTitle', { defaultValue: 'No identity candidates' })}
                </p>
                <ul className="mt-1 list-inside list-disc">
                  {excludedItems.map((item) => (
                    <li key={item.proposal.proposalId}>
                      {companyLabel(item.proposal.normalizedEmployerSurface)}
                    </li>
                  ))}
                </ul>
                <p className="mt-1">
                  {t('industryEvidence.identityNoCandidatesHint', {
                    defaultValue: 'Queue targeted research for these rows, then retry once candidates are attached.',
                  })}
                </p>
              </div>
            </div>
          ) : null}

          {resolvableItems.map((item) => {
            const proposalId = item.proposal.proposalId
            const candidates = packets.get(proposalId)?.candidates ?? []
            const selection = selections[proposalId]
            const invalidReason = invalidItems.find((entry) => entry.proposalId === proposalId)?.reason
            return (
              <div key={proposalId} className="rounded-lg border p-3" data-testid={`industry-identity-item-${proposalId}`}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold">
                    {companyLabel(item.proposal.companyKey ?? item.proposal.normalizedEmployerSurface)}
                  </p>
                  <Badge variant="secondary" className="text-[10px]">{item.proposal.status}</Badge>
                </div>

                <div role="group" aria-label={t('industryEvidence.identityCandidateGroupLabel', {
                  defaultValue: 'Identity candidates',
                })} className="space-y-1.5">
                  {candidates.map((candidate) => {
                    const active = selection?.candidateFingerprint === candidate.candidateFingerprint
                    const rejected = candidate.reviewState === 'rejected'
                    return (
                      <button
                        key={candidate.candidateFingerprint}
                        type="button"
                        disabled={rejected}
                        aria-pressed={active}
                        onClick={() => setSelection(proposalId, {
                          candidateFingerprint: candidate.candidateFingerprint,
                          displayName: candidate.normalizedLegalName,
                          alias: '',
                        })}
                        className={cn(
                          'w-full rounded-md border bg-background p-2.5 text-left text-xs transition-colors',
                          active ? 'border-primary ring-2 ring-primary/20' : 'hover:border-primary/40',
                          rejected ? 'cursor-not-allowed opacity-50' : '',
                        )}
                        data-testid={`industry-identity-candidate-${proposalId}-${candidate.candidateFingerprint}`}
                      >
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold">{candidate.normalizedLegalName}</span>
                          <span className="flex flex-wrap items-center gap-1">
                            <Badge variant="outline" className="text-[10px]">
                              {Math.round(candidate.confidence * 100)}%
                            </Badge>
                            {candidate.reviewState !== 'candidate' ? (
                              <Badge variant="secondary" className="text-[10px]">{candidate.reviewState}</Badge>
                            ) : null}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          {t('industryEvidence.identitySourceCount', {
                            defaultValue: '{{count}} fetched source(s)',
                            count: candidate.sourceIds.length,
                          })}
                          {candidateSummary(candidate) ? ` · ${candidateSummary(candidate)}` : ''}
                        </span>
                        {candidate.conflictCodes.length > 0 ? (
                          <span className="mt-1 flex flex-wrap gap-1">
                            {candidate.conflictCodes.map((code) => (
                              <Badge key={code} variant="outline" className="text-[10px] text-amber-700">
                                {code.replace(/_/g, ' ')}
                              </Badge>
                            ))}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>

                {selection ? (
                  <div className="mt-2.5 space-y-2.5 border-t pt-2.5">
                    <div className="flex flex-wrap gap-4">
                      <label className="flex items-center gap-1.5 text-xs font-medium">
                        <input
                          type="radio"
                          name={`identity-mode-${proposalId}`}
                          checked={selection.mappingMode === 'create_provisional'}
                          onChange={() => setSelection(proposalId, { mappingMode: 'create_provisional' })}
                          data-testid={`industry-identity-mode-provisional-${proposalId}`}
                        />
                        <ContactRound className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                        {t('industryEvidence.identityModeProvisional', { defaultValue: 'Create provisional company' })}
                      </label>
                      <label className="flex items-center gap-1.5 text-xs font-medium">
                        <input
                          type="radio"
                          name={`identity-mode-${proposalId}`}
                          checked={selection.mappingMode === 'existing'}
                          onChange={() => setSelection(proposalId, { mappingMode: 'existing' })}
                          data-testid={`industry-identity-mode-existing-${proposalId}`}
                        />
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                        {t('industryEvidence.identityModeExisting', { defaultValue: 'Map to existing company' })}
                      </label>
                    </div>

                    {selection.mappingMode === 'create_provisional' ? (
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        <label className="space-y-1 text-xs font-medium">
                          {t('industryEvidence.identityDisplayNameLabel', { defaultValue: 'Display name' })}
                          <Input
                            value={selection.displayName}
                            onChange={(event) => setSelection(proposalId, { displayName: event.target.value })}
                            disabled={submitting}
                            data-testid={`industry-identity-display-name-${proposalId}`}
                          />
                        </label>
                        <label className="space-y-1 text-xs font-medium">
                          {t('industryEvidence.identityAliasLabel', { defaultValue: 'Alias (optional)' })}
                          <Input
                            value={selection.alias}
                            onChange={(event) => setSelection(proposalId, { alias: event.target.value })}
                            placeholder={t('industryEvidence.identityAliasPlaceholder', {
                              defaultValue: 'Defaults to the candidate legal name',
                            })}
                            disabled={submitting}
                            data-testid={`industry-identity-alias-${proposalId}`}
                          />
                        </label>
                      </div>
                    ) : (
                      <div className="grid gap-2.5 sm:grid-cols-[1fr_2fr]">
                        <label className="space-y-1 text-xs font-medium">
                          {t('industryEvidence.identityRegistryFilterLabel', { defaultValue: 'Filter registry' })}
                          <Input
                            value={registryFilter}
                            onChange={(event) => setRegistryFilter(event.target.value)}
                            placeholder={t('industryEvidence.identityRegistryFilterPlaceholder', {
                              defaultValue: 'Search name or key…',
                            })}
                            disabled={submitting}
                            data-testid="industry-identity-registry-filter"
                          />
                        </label>
                        <label className="space-y-1 text-xs font-medium">
                          {t('industryEvidence.identityCompanyLabel', { defaultValue: 'Canonical company' })}
                          <select
                            value={selection.companyKey ?? ''}
                            onChange={(event) => setSelection(proposalId, { companyKey: event.target.value })}
                            disabled={submitting || companiesLoading}
                            className={cn(
                              'h-9 w-full rounded-md border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring',
                              !selection.companyKey ? 'border-amber-400 text-amber-800' : 'text-foreground',
                            )}
                            data-testid={`industry-identity-company-${proposalId}`}
                          >
                            <option value="">
                              {companiesLoading
                                ? t('industryEvidence.identityCompaniesLoading', { defaultValue: 'Loading registry…' })
                                : t('industryEvidence.identityCompanyRequired', { defaultValue: 'Select a registry company…' })}
                            </option>
                            {filteredCompanies.map((company) => (
                              <option key={company.companyKey} value={company.companyKey}>
                                {company.displayName} · {company.companyKey}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    )}

                    {invalidReason === 'company' ? (
                      <p className="text-xs text-amber-800">
                        {t('industryEvidence.identityCompanyMissing', {
                          defaultValue: 'Choose a canonical company to map to.',
                        })}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}

          <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
            <Label htmlFor="industry-identity-note" className="text-xs">
              {t('industryEvidence.identityNoteLabel', { defaultValue: 'Identity review note (optional)' })}
            </Label>
            <Textarea
              id="industry-identity-note"
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              placeholder={t('industryEvidence.identityNotePlaceholder', {
                defaultValue: 'Why these legal names match their employers (recorded in the identity audit).',
              })}
              rows={2}
              disabled={submitting}
              data-testid="industry-identity-note"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="industry-identity-resolve-submit"
          >
            <IdCard className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {submitting
              ? t('common.submitting', { defaultValue: 'Submitting…' })
              : t('industryEvidence.identityResolveSubmit', {
                  defaultValue: 'Resolve {{count}}',
                  count: resolvableItems.length,
                })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
