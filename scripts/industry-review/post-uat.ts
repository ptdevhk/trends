import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference, type DefaultFunctionArgs } from 'convex/server'

type IndustryProposalStatus = 'new' | 'researching' | 'ready_for_review' | 'needs_more_evidence' | 'approved' | 'rejected' | 'superseded'
type LocalProposal = { proposalId: string; companyKey?: string; status: IndustryProposalStatus; approvedRevisionId?: string; recomputeRunId?: string; updatedAt: number }
type LocalRevision = { revisionId: string; proposalId?: string; createdAt: number; reviewAttestation?: { inputFingerprint?: string; decisionMode?: string; cncEvidenceAcknowledged?: boolean } }
type LocalRecomputeRun = { runId: string; proposalId?: string; targetRevisionId: string; status: string; updatedAt: number; affectedCount?: number; readyCount?: number; failureCount?: number; failures?: Array<{ stage?: string; message?: string }> }
type LocalLedgerRow = { runId: string; proposalId: string; action: string; reason: string }
type LocalMaintenanceRun = { runId: string; status: string; triggerSource?: string; triggerContext?: string; startedAt?: number; finishedAt?: number; counts?: Record<string, number>; operatorSummary?: string; failureMessage?: string }
type UatCaseBefore = { caseId: string; proposalId: string; localCompanyKey?: string; proposal: LocalProposal | null; revisions: LocalRevision[]; recomputeRuns: LocalRecomputeRun[]; ledger: LocalLedgerRow[] }
type UatState = { schemaVersion: 'industry-review-uat-state.v1'; namespace: string; workspaceSlug: string; fixturePath: string; manualApprovalCase: string; localCompanyKeys: Record<string, string>; before: { capturedAt: number; coverage: CoverageSummary; cases: UatCaseBefore[] } }
type CoverageSummary = { proposalsByStatus?: Record<string, number>; openTotal?: number; profiles?: { verified?: number }; resumes?: { withVerifiedEvidence?: number }; maintenance?: unknown }

type CliOptions = { stateFile: string; convexUrl: string }
const defaultConvexUrl = 'http://127.0.0.1:3210'

function fail(message: string): never {
  throw new Error(message)
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    stateFile: resolve('tmp/industry-review/cnc-cockpit-uat-before.json'),
    convexUrl: process.env.CONVEX_URL?.trim() || defaultConvexUrl,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) fail(`missing value for ${arg}`)
      index += 1
      return value
    }
    if (arg === '--state-file') options.stateFile = resolve(next())
    else if (arg === '--convex-url') options.convexUrl = next()
    else fail(`unknown option ${arg}`)
  }
  return options
}

function assertLocalConvexUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:') fail('post-UAT verification requires an http loopback Convex URL')
  if (!new Set(['127.0.0.1', 'localhost', '[::1]', '::1']).has(url.hostname)) {
    fail(`refusing post-UAT verification for non-loopback Convex host ${url.hostname}`)
  }
  return url.toString().replace(/\/$/, '')
}

function queryRef<Args extends DefaultFunctionArgs, Result>(name: string) {
  return makeFunctionReference<'query', Args, Result>(name)
}

function countByStatus(summary: CoverageSummary, status: string): number {
  return summary.proposalsByStatus?.[status] ?? 0
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const convexUrl = assertLocalConvexUrl(options.convexUrl)
  const writeSecret = process.env.CONVEX_WRITE_SECRET?.trim()
  if (!writeSecret) fail('CONVEX_WRITE_SECRET is required for post-UAT verification')
  const state = JSON.parse(readFileSync(options.stateFile, 'utf8')) as UatState
  if (state.schemaVersion !== 'industry-review-uat-state.v1') fail('unexpected local UAT state schema')

  const client = new ConvexHttpClient(convexUrl)
  const query = <Args extends DefaultFunctionArgs, Result>(name: string, args: Args) => client.query(queryRef<Args, Result>(name), args as never) as Promise<Result>
  const secretArgs = { writeSecret }
  const coverage = await query<{ writeSecret: string; workspaceSlug: string }, CoverageSummary>('companies:getIndustryCoverageSummary', { ...secretArgs, workspaceSlug: state.workspaceSlug })
  const proposals = await query<typeof secretArgs, LocalProposal[]>('companies:listIndustryProposals', secretArgs)
  const maintenanceRuns = await query<{ writeSecret: string; workspaceSlug: string; limit: number }, LocalMaintenanceRun[]>('companies:listIndustryMaintenanceRuns', { ...secretArgs, workspaceSlug: state.workspaceSlug, limit: 100 })
  const proposalsById = new Map(proposals.map((proposal) => [proposal.proposalId, proposal]))
  const maintenanceRun = maintenanceRuns
    .filter((run) => (
      (run.startedAt ?? 0) >= state.before.capturedAt
      && run.triggerSource === 'approval'
      && run.triggerContext?.includes(state.manualApprovalCase)
    ))
    .sort((left, right) => (right.startedAt ?? 0) - (left.startedAt ?? 0))[0] ?? null
  if (!maintenanceRun) fail(`no approval-triggered maintenance run found for ${state.manualApprovalCase}`)
  if (!new Set(['completed', 'failed', 'skipped']).has(maintenanceRun.status)) fail(`approval-triggered maintenance run is still non-terminal (${maintenanceRun.status})`)
  const maintenanceRunLedger = await query<{ writeSecret: string; runId: string; limit: number }, LocalLedgerRow[]>('companies:listIndustryMaintenanceLedger', { ...secretArgs, runId: maintenanceRun.runId, limit: 500 })
  const caseResults: Array<Record<string, unknown>> = []

  for (const beforeCase of state.before.cases) {
    const currentProposal = proposalsById.get(beforeCase.proposalId) ?? null
    const currentRevisions = beforeCase.localCompanyKey
      ? await query<{ writeSecret: string; companyKey: string }, LocalRevision[]>('companies:listIndustryVerdictRevisions', { ...secretArgs, companyKey: beforeCase.localCompanyKey })
      : []
    const currentRecomputeRuns = beforeCase.localCompanyKey
      ? await query<{ writeSecret: string; workspaceSlug: string; companyKey: string; limit: number }, LocalRecomputeRun[]>('companies:listIndustryRecomputeRuns', { ...secretArgs, workspaceSlug: state.workspaceSlug, companyKey: beforeCase.localCompanyKey, limit: 50 })
      : []
    const currentLedger = await query<{ writeSecret: string; proposalId: string; limit: number }, LocalLedgerRow[]>('companies:listIndustryMaintenanceLedger', { ...secretArgs, proposalId: beforeCase.proposalId, limit: 200 })
    const newRevisionRows = currentRevisions.filter((revision) => !beforeCase.revisions.some((before) => before.revisionId === revision.revisionId) && revision.proposalId === beforeCase.proposalId)
    const newRecomputeRows = currentRecomputeRuns.filter((run) => !beforeCase.recomputeRuns.some((before) => before.runId === run.runId) && run.proposalId === beforeCase.proposalId)
    const isManual = beforeCase.caseId === state.manualApprovalCase
    if (isManual) {
      if (!currentProposal || currentProposal.status !== 'approved') fail(`${beforeCase.caseId}: attended CNC proposal is not approved`)
      if (newRevisionRows.length !== 1) fail(`${beforeCase.caseId}: expected exactly one new immutable revision, found ${newRevisionRows.length}`)
      const revision = newRevisionRows[0]
      if (!revision.reviewAttestation?.cncEvidenceAcknowledged) fail(`${beforeCase.caseId}: revision is missing CNC acknowledgement audit data`)
      if (revision.reviewAttestation.decisionMode !== 'standard' && revision.reviewAttestation.decisionMode !== 'risk_override') fail(`${beforeCase.caseId}: revision has invalid attestation mode`)
      if (newRecomputeRows.length !== 1) fail(`${beforeCase.caseId}: expected exactly one targeted recompute run, found ${newRecomputeRows.length}`)
      if (!new Set(['completed', 'failed', 'partial_failed', 'superseded']).has(newRecomputeRows[0].status)) fail(`${beforeCase.caseId}: targeted recompute is still non-terminal (${newRecomputeRows[0].status})`)
    } else if (newRevisionRows.length > 0 || newRecomputeRows.length > 0) {
      fail(`${beforeCase.caseId}: non-manual fixture unexpectedly changed truth or recompute state`)
    }
    caseResults.push({
      caseId: beforeCase.caseId,
      proposalId: beforeCase.proposalId,
      localCompanyKey: beforeCase.localCompanyKey,
      status: currentProposal?.status ?? null,
      newRevisionIds: newRevisionRows.map((revision) => revision.revisionId),
      newRecomputeRunIds: newRecomputeRows.map((run) => run.runId),
      recomputeStatus: newRecomputeRows[0]?.status ?? null,
      recomputeFailureCount: newRecomputeRows[0]?.failureCount ?? 0,
      recomputeFailures: newRecomputeRows[0]?.failures ?? [],
      ledgerRowsBefore: beforeCase.ledger.length,
      ledgerRowsAfter: currentLedger.length,
    })
  }

  const approvedDelta = countByStatus(coverage, 'approved') - countByStatus(state.before.coverage, 'approved')
  const verifiedProfileDelta = (coverage.profiles?.verified ?? 0) - (state.before.coverage.profiles?.verified ?? 0)
  if (approvedDelta !== 1) fail(`coverage approved delta is ${approvedDelta}; expected exactly one approval`)
  if (verifiedProfileDelta < 1) fail(`verified profile coverage did not increase: delta ${verifiedProfileDelta}`)

  const manualResult = caseResults.find((item) => item.caseId === state.manualApprovalCase)
  const recomputeHadFailures = (manualResult?.recomputeFailureCount as number | undefined ?? 0) > 0
  const report = {
    schemaVersion: 'industry-review-uat-report.v1',
    namespace: state.namespace,
    mode: 'local-read-only-postcheck',
    mutationsAttempted: 0,
    status: recomputeHadFailures ? 'passed_with_local_recompute_failure' : 'passed',
    manualApprovalCase: state.manualApprovalCase,
    exactlyOneApproval: approvedDelta === 1,
    exactlyOneRecompute: caseResults.filter((item) => Array.isArray(item.newRecomputeRunIds) && (item.newRecomputeRunIds as unknown[]).length === 1).length === 1,
    recomputeOutcome: recomputeHadFailures
      ? 'terminal_failure_recorded_without_additional_truth_mutation'
      : 'completed',
    coverage: {
      before: state.before.coverage,
      after: coverage,
      approvedDelta,
      verifiedProfileDelta,
    },
    maintenance: {
      runId: maintenanceRun.runId,
      status: maintenanceRun.status,
      triggerSource: maintenanceRun.triggerSource,
      triggerContext: maintenanceRun.triggerContext,
      startedAt: maintenanceRun.startedAt,
      finishedAt: maintenanceRun.finishedAt,
      counts: maintenanceRun.counts,
      operatorSummary: maintenanceRun.operatorSummary,
      failureMessage: maintenanceRun.failureMessage,
      ledgerRows: maintenanceRunLedger.length,
    },
    fixtureLedger: {
      before: state.before.cases.reduce((total, item) => total + item.ledger.length, 0),
      after: caseResults.reduce((total, item) => total + Number(item.ledgerRowsAfter ?? 0), 0),
    },
    cases: caseResults,
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
