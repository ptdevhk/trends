import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from 'convex/react'
import { api } from '../../../../../packages/convex/convex/_generated/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  AUDIT_QUERY_LIMIT,
  DECISION_MODE_LABELS,
  formatAuditTimestamp,
  identityAuditRow,
  INDUSTRY_CLASS_LABELS,
  MAPPING_MODE_LABELS,
  REVIEWER_TYPE_LABELS,
  riskFlagLabelKey,
  RISK_FLAG_LABELS,
  verdictAuditRow,
  VERIFICATION_LEVEL_LABELS,
} from './industry-audit-model'

/**
 * Industry audit surface (C6): verdict revisions (decision history) and
 * identity-resolution audits, served by the committed convex queries
 * `api.industry_verdicts.listIndustryVerdictRevisionsPage` and
 * `api.industry_identity.listIndustryIdentityResolutionAudits`. The
 * workspace slug from the route (`teamSlug`) scopes the identity audits.
 */
export default function SystemSettingsIndustryAuditPage() {
  const { t } = useTranslation()
  const { teamSlug } = useParams()

  const [proposalIdDraft, setProposalIdDraft] = useState('')
  const [proposalIdFilter, setProposalIdFilter] = useState('')
  const [batchIdDraft, setBatchIdDraft] = useState('')
  const [batchIdFilter, setBatchIdFilter] = useState('')

  const identityAudits = useQuery(
    api.industry_identity.listIndustryIdentityResolutionAudits,
    {
      workspaceSlug: teamSlug ?? '',
      proposalId: proposalIdFilter || undefined,
      limit: AUDIT_QUERY_LIMIT,
    },
  )
  const verdictRevisions = useQuery(
    api.industry_verdicts.listIndustryVerdictRevisionsPage,
    {
      batchId: batchIdFilter || undefined,
      limit: AUDIT_QUERY_LIMIT,
    },
  )

  if (identityAudits === undefined || verdictRevisions === undefined) {
    return (
      <div
        className="flex items-center gap-2 py-8 text-sm text-muted-foreground"
        data-testid="industry-audit-loading"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('industryAudit.loading', { defaultValue: 'Loading audit records…' })}
      </div>
    )
  }

  const identityRows = identityAudits.map((audit) => ({
    key: audit.auditId,
    row: identityAuditRow(audit),
  }))
  const verdictRows = verdictRevisions.map((revision) => ({
    key: revision.revisionId,
    row: verdictAuditRow(revision),
  }))

  const mappingModeLabel = (mode: string): string =>
    t(`industryAudit.mappingModes.${mode}`, {
      defaultValue: MAPPING_MODE_LABELS[mode] ?? mode,
    })
  const classLabel = (value: string): string =>
    t(`industryAudit.classes.${value}`, {
      defaultValue: INDUSTRY_CLASS_LABELS[value] ?? value,
    })
  const levelLabel = (value: string): string =>
    t(`industryAudit.levels.${value}`, {
      defaultValue: VERIFICATION_LEVEL_LABELS[value] ?? value,
    })
  const decisionModeLabel = (value: string): string =>
    value
      ? t(`industryAudit.decisionModes.${value}`, {
          defaultValue: DECISION_MODE_LABELS[value] ?? value,
        })
      : '—'
  const reviewerTypeLabel = (value: string): string =>
    value
      ? t(`industryAudit.reviewerTypes.${value}`, {
          defaultValue: REVIEWER_TYPE_LABELS[value] ?? value,
        })
      : '—'
  const riskFlagLabel = (flag: string): string =>
    t(riskFlagLabelKey(flag), { defaultValue: RISK_FLAG_LABELS[flag] ?? flag })

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">
          {t('industryAudit.title', { defaultValue: 'Industry audit' })}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('industryAudit.description', {
            defaultValue:
              'Decision history for industry verdict revisions and employer identity resolution, including attestation details.',
          })}
        </p>
      </div>

      <Card data-testid="industry-audit-identity-section">
        <CardHeader>
          <CardTitle className="text-base">
            {t('industryAudit.identitySectionTitle', { defaultValue: 'Identity-resolution audits' })}
          </CardTitle>
          <CardDescription>
            {t('industryAudit.identitySectionDescription', {
              defaultValue:
                'Workspace-scoped record of employer identity mappings (existing or provisional), newest first.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="mb-4 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              setProposalIdFilter(proposalIdDraft.trim())
            }}
          >
            <Input
              value={proposalIdDraft}
              onChange={(event) => setProposalIdDraft(event.target.value)}
              onBlur={() => setProposalIdFilter(proposalIdDraft.trim())}
              placeholder={t('industryAudit.proposalIdFilterPlaceholder', { defaultValue: 'proposal-…' })}
              aria-label={t('industryAudit.proposalIdFilterLabel', { defaultValue: 'Filter by proposal' })}
              className="max-w-xs"
              data-testid="industry-audit-proposal-filter"
            />
            <Button type="submit" variant="outline" size="sm">
              {t('industryAudit.applyFilter', { defaultValue: 'Apply' })}
            </Button>
          </form>
          {identityRows.length === 0 ? (
            <div
              className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground"
              data-testid="industry-audit-identity-empty"
            >
              {t('industryAudit.identityEmpty', { defaultValue: 'No identity-resolution audits yet.' })}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('industryAudit.actor', { defaultValue: 'Actor' })}</TableHead>
                  <TableHead>{t('industryAudit.mappingMode', { defaultValue: 'Mapping mode' })}</TableHead>
                  <TableHead>{t('industryAudit.targetCompanyKey', { defaultValue: 'Target company' })}</TableHead>
                  <TableHead>{t('industryAudit.proposalId', { defaultValue: 'Proposal' })}</TableHead>
                  <TableHead>{t('industryAudit.sourceCount', { defaultValue: 'Sources' })}</TableHead>
                  <TableHead>{t('industryAudit.createdAt', { defaultValue: 'Created at' })}</TableHead>
                  <TableHead>{t('industryAudit.reviewNote', { defaultValue: 'Review note' })}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {identityRows.map(({ key, row }) => (
                  <TableRow key={key} data-testid="industry-audit-identity-row">
                    <TableCell className="font-medium">{row.actor}</TableCell>
                    <TableCell>{mappingModeLabel(row.mappingMode)}</TableCell>
                    <TableCell className="font-mono text-xs">{row.targetCompanyKey}</TableCell>
                    <TableCell className="font-mono text-xs">{row.proposalId}</TableCell>
                    <TableCell>{row.sourceCount}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatAuditTimestamp(row.createdAt)}
                    </TableCell>
                    <TableCell className="max-w-xs text-xs text-muted-foreground">
                      {row.reviewNote || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card data-testid="industry-audit-verdict-section">
        <CardHeader>
          <CardTitle className="text-base">
            {t('industryAudit.verdictSectionTitle', { defaultValue: 'Verdict revisions' })}
          </CardTitle>
          <CardDescription>
            {t('industryAudit.verdictSectionDescription', {
              defaultValue: 'Immutable industry verdict decisions with reviewer and attestation details, newest first.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="mb-4 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              setBatchIdFilter(batchIdDraft.trim())
            }}
          >
            <Input
              value={batchIdDraft}
              onChange={(event) => setBatchIdDraft(event.target.value)}
              onBlur={() => setBatchIdFilter(batchIdDraft.trim())}
              placeholder={t('industryAudit.batchIdFilterPlaceholder', { defaultValue: 'batch-…' })}
              aria-label={t('industryAudit.batchIdFilterLabel', { defaultValue: 'Filter by batch' })}
              className="max-w-xs"
              data-testid="industry-audit-batch-filter"
            />
            <Button type="submit" variant="outline" size="sm">
              {t('industryAudit.applyFilter', { defaultValue: 'Apply' })}
            </Button>
          </form>
          {verdictRows.length === 0 ? (
            <div
              className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground"
              data-testid="industry-audit-verdict-empty"
            >
              {t('industryAudit.verdictEmpty', { defaultValue: 'No verdict revisions yet.' })}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('industryAudit.companyKey', { defaultValue: 'Company' })}</TableHead>
                  <TableHead>{t('industryAudit.industryClass', { defaultValue: 'Industry class' })}</TableHead>
                  <TableHead>{t('industryAudit.verificationLevel', { defaultValue: 'Verification level' })}</TableHead>
                  <TableHead>{t('industryAudit.reviewedBy', { defaultValue: 'Reviewed by' })}</TableHead>
                  <TableHead>{t('industryAudit.reviewedAt', { defaultValue: 'Reviewed at' })}</TableHead>
                  <TableHead>{t('industryAudit.decisionMode', { defaultValue: 'Decision mode' })}</TableHead>
                  <TableHead>{t('industryAudit.riskFlags', { defaultValue: 'Risk flags' })}</TableHead>
                  <TableHead>{t('industryAudit.batchId', { defaultValue: 'Batch' })}</TableHead>
                  <TableHead>{t('industryAudit.decisionReason', { defaultValue: 'Decision reason' })}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {verdictRows.map(({ key, row }) => (
                  <TableRow key={key} data-testid="industry-audit-verdict-row">
                    <TableCell className="font-mono text-xs">{row.companyKey}</TableCell>
                    <TableCell>{classLabel(row.industryClass)}</TableCell>
                    <TableCell>
                      <Badge variant={row.verificationLevel === 'verified' ? 'default' : 'destructive'}>
                        {levelLabel(row.verificationLevel)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{row.reviewedBy}</span>
                      {row.reviewerType ? (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          · {reviewerTypeLabel(row.reviewerType)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatAuditTimestamp(row.reviewedAt)}
                    </TableCell>
                    <TableCell>{decisionModeLabel(row.decisionMode)}</TableCell>
                    <TableCell>
                      {row.acknowledgedRiskFlags.length === 0 ? (
                        '—'
                      ) : (
                        <div className="flex max-w-xs flex-wrap gap-1">
                          {row.acknowledgedRiskFlags.map((flag) => (
                            <Badge key={flag} variant="outline" className="text-[10px]">
                              {riskFlagLabel(flag)}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    {row.batchId ? (
                      <TableCell className="font-mono text-xs" data-testid="industry-audit-batch-cell">
                        {row.batchId}
                      </TableCell>
                    ) : (
                      <TableCell>—</TableCell>
                    )}
                    <TableCell className="max-w-xs text-xs text-muted-foreground">{row.decisionReason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
