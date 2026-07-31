import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference, type DefaultFunctionArgs } from 'convex/server'

type IndustryClass = 'cnc' | 'automation' | 'metrology' | 'industrial' | 'non_industry' | 'unknown'
type IndustryProposalStatus = 'new' | 'researching' | 'ready_for_review' | 'needs_more_evidence' | 'approved' | 'rejected' | 'superseded'
type SourceType = 'official_site' | 'registry' | 'taxonomy' | 'oem_partner' | 'trade_body' | 'directory' | 'reporting' | 'other' | 'search_result'
type TrustTier = 'primary' | 'authoritative' | 'corroborating' | 'discovery'
type FetchStatus = 'pending' | 'fetched' | 'failed' | 'unavailable'

type FixtureSource = {
  sourceId: string
  url: string
  sourceType: SourceType
  trustTier: TrustTier
  title?: string
  evidenceExcerpt?: string
  fetchStatus: FetchStatus
  sourceState?: 'active' | 'superseded' | 'unavailable' | 'disputed'
  suggestedIndustryClass?: IndustryClass
}

type FixtureCase = {
  id: string
  kind: string
  companyKey: string | null
  suggestedIndustryClass?: IndustryClass
  sources: FixtureSource[]
  expected: { recommendedAction: string }
}

type Fixture = {
  schemaVersion: string
  namespace: string
  localSetup?: {
    manualApprovalCase?: string
    companyKeyByCase?: Record<string, string>
  }
  cases: FixtureCase[]
}

type LocalCompany = { companyKey: string; displayName: string }
type LocalProposal = {
  proposalId: string
  companyKey?: string
  normalizedEmployerSurface?: string
  status: IndustryProposalStatus
  updatedAt: number
}
type LocalRevision = { revisionId: string; proposalId?: string; createdAt: number }
type LocalRecomputeRun = { runId: string; proposalId?: string; targetRevisionId: string; status: string; updatedAt: number }
type LocalLedgerRow = { runId: string; proposalId: string; action: string; reason: string }

type UatSnapshot = {
  capturedAt: number
  coverage: unknown
  cases: Array<{
    caseId: string
    proposalId: string
    localCompanyKey?: string
    proposal: LocalProposal | null
    revisions: LocalRevision[]
    recomputeRuns: LocalRecomputeRun[]
    ledger: LocalLedgerRow[]
  }>
}

type UatState = {
  schemaVersion: 'industry-review-uat-state.v1'
  namespace: string
  workspaceSlug: string
  fixturePath: string
  manualApprovalCase: string
  localCompanyKeys: Record<string, string>
  before: UatSnapshot
}

type CliOptions = {
  fixturePath: string
  convexUrl: string
  workspaceSlug: string
  stateFile: string
  explicitCompanyKey?: string
  allowLocalWrite: boolean
}

const openStatuses = new Set<IndustryProposalStatus>(['new', 'researching', 'ready_for_review', 'needs_more_evidence'])
const defaultConvexUrl = 'http://127.0.0.1:3210'

function fail(message: string): never {
  throw new Error(message)
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    fixturePath: resolve('scripts/industry-review/fixtures/cnc-review-cases.json'),
    convexUrl: process.env.CONVEX_URL?.trim() || defaultConvexUrl,
    workspaceSlug: 'dev',
    stateFile: resolve('tmp/industry-review/cnc-cockpit-uat-before.json'),
    allowLocalWrite: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) fail(`missing value for ${arg}`)
      index += 1
      return value
    }
    if (arg === '--fixture') options.fixturePath = resolve(next())
    else if (arg === '--convex-url') options.convexUrl = next()
    else if (arg === '--workspace') options.workspaceSlug = next()
    else if (arg === '--state-file') options.stateFile = resolve(next())
    else if (arg === '--company-key') options.explicitCompanyKey = next()
    else if (arg === '--allow-local-write') options.allowLocalWrite = true
    else fail(`unknown option ${arg}`)
  }
  return options
}

function assertLocalConvexUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:') fail('local UAT fixture setup requires an http loopback Convex URL')
  if (!new Set(['127.0.0.1', 'localhost', '[::1]', '::1']).has(url.hostname)) {
    fail(`refusing fixture setup for non-loopback Convex host ${url.hostname}`)
  }
  if (url.port && !new Set(['3210', '3211']).has(url.port)) {
    fail(`refusing fixture setup for unexpected local Convex port ${url.port}`)
  }
  return url.toString().replace(/\/$/, '')
}

function readFixture(path: string): Fixture {
  const fixture = JSON.parse(readFileSync(path, 'utf8')) as Fixture
  if (fixture.schemaVersion !== 'industry-review-uat.v1') fail(`unexpected fixture schema in ${path}`)
  if (!fixture.namespace.endsWith('uat')) fail('fixture namespace must end with uat')
  if (!Array.isArray(fixture.cases) || fixture.cases.length < 7) fail('fixture is missing required UAT cases')
  return fixture
}

function proposalIdFor(namespace: string, caseId: string): string {
  return `${namespace}/${caseId.slice(namespace.length + 1)}`
}

function queryRef<Args extends DefaultFunctionArgs, Result>(name: string) {
  return makeFunctionReference<'query', Args, Result>(name)
}

function mutationRef<Args extends DefaultFunctionArgs, Result>(name: string) {
  return makeFunctionReference<'mutation', Args, Result>(name)
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  if (!options.allowLocalWrite) {
    fail('fixture setup is a local write; rerun with --allow-local-write')
  }
  const convexUrl = assertLocalConvexUrl(options.convexUrl)
  const writeSecret = process.env.CONVEX_WRITE_SECRET?.trim()
  if (!writeSecret) fail('CONVEX_WRITE_SECRET is required for local fixture setup')
  const fixture = readFixture(options.fixturePath)
  const manualApprovalCase = fixture.localSetup?.manualApprovalCase ?? `${fixture.namespace}/explicit-cnc`
  const configuredCompanyKeys = { ...(fixture.localSetup?.companyKeyByCase ?? {}) }
  if (options.explicitCompanyKey) configuredCompanyKeys[manualApprovalCase] = options.explicitCompanyKey

  if (existsSync(options.stateFile)) {
    const existingState = JSON.parse(readFileSync(options.stateFile, 'utf8')) as Partial<UatState>
    if (existingState.namespace === fixture.namespace) {
      fail(`state file already exists at ${options.stateFile}; preserve the pre-approval snapshot and do not overwrite it`)
    }
  }

  const client = new ConvexHttpClient(convexUrl)
  const query = <Args extends DefaultFunctionArgs, Result>(name: string, args: Args) => client.query(queryRef<Args, Result>(name), args as never) as Promise<Result>
  const mutate = <Args extends DefaultFunctionArgs, Result>(name: string, args: Args) => client.mutation(mutationRef<Args, Result>(name), args as never) as Promise<Result>
  const secretArgs = { writeSecret }
  const companies = await query<typeof secretArgs, LocalCompany[]>('companies:list', secretArgs)
  const companyKeys = new Set(companies.map((company) => company.companyKey))
  const proposals = await query<typeof secretArgs, LocalProposal[]>('companies:listIndustryProposals', secretArgs)
  const proposalById = new Map(proposals.map((proposal) => [proposal.proposalId, proposal]))
  const openByCompany = new Map(
    proposals
      .filter((proposal) => proposal.companyKey && openStatuses.has(proposal.status))
      .map((proposal) => [proposal.companyKey as string, proposal]),
  )

  const localCompanyKeys: Record<string, string> = {}
  for (const item of fixture.cases) {
    if (!item.companyKey) continue
    const localCompanyKey = configuredCompanyKeys[item.id]
    if (!localCompanyKey) fail(`${item.id} needs localSetup.companyKeyByCase mapping`)
    if (!companyKeys.has(localCompanyKey)) fail(`local company ${localCompanyKey} is not present in Convex`)
    localCompanyKeys[item.id] = localCompanyKey
    const proposalId = proposalIdFor(fixture.namespace, item.id)
    const existing = proposalById.get(proposalId)
    const otherOpen = openByCompany.get(localCompanyKey)
    if (otherOpen && otherOpen.proposalId !== proposalId) {
      fail(`local company ${localCompanyKey} already has open proposal ${otherOpen.proposalId}; choose another local company`)
    }
    if (existing && existing.companyKey !== localCompanyKey) {
      fail(`${proposalId} is attached to unexpected company ${existing.companyKey ?? '<missing>'}`)
    }
  }

  const coverageBefore = await query<{ writeSecret: string; workspaceSlug: string }, unknown>(
    'companies:getIndustryCoverageSummary',
    { ...secretArgs, workspaceSlug: options.workspaceSlug },
  )
  const beforeCases: UatSnapshot['cases'] = []
  for (const item of fixture.cases) {
    const proposalId = proposalIdFor(fixture.namespace, item.id)
    const localCompanyKey = localCompanyKeys[item.id]
    const proposal = proposalById.get(proposalId) ?? null
    const revisions = localCompanyKey
      ? await query<{ writeSecret: string; companyKey: string }, LocalRevision[]>('companies:listIndustryVerdictRevisions', { ...secretArgs, companyKey: localCompanyKey })
      : []
    const recomputeRuns = localCompanyKey
      ? await query<{ writeSecret: string; workspaceSlug: string; companyKey: string; limit: number }, LocalRecomputeRun[]>('companies:listIndustryRecomputeRuns', { ...secretArgs, workspaceSlug: options.workspaceSlug, companyKey: localCompanyKey, limit: 50 })
      : []
    const ledger = await query<{ writeSecret: string; proposalId: string; limit: number }, LocalLedgerRow[]>('companies:listIndustryMaintenanceLedger', { ...secretArgs, proposalId, limit: 200 })
    beforeCases.push({ caseId: item.id, proposalId, ...(localCompanyKey ? { localCompanyKey } : {}), proposal, revisions, recomputeRuns, ledger })
  }

  const setupResults: Array<{ caseId: string; proposalId: string; localCompanyKey?: string; created: boolean; status: string }> = []
  for (const item of fixture.cases) {
    const proposalId = proposalIdFor(fixture.namespace, item.id)
    const localCompanyKey = localCompanyKeys[item.id]
    const existing = proposalById.get(proposalId)
    if (existing?.status === 'approved') {
      setupResults.push({ caseId: item.id, proposalId, ...(localCompanyKey ? { localCompanyKey } : {}), created: false, status: existing.status })
      continue
    }

    const proposalInput = {
      ...secretArgs,
      proposalId,
      ...(localCompanyKey ? { companyKey: localCompanyKey } : { normalizedEmployerSurface: item.id }),
      triggerReasons: ['manual'],
      priority: 100,
      suggestedIndustryClass: item.suggestedIndustryClass,
      suggestedVerificationLevel: 'candidate' as const,
      materialChangeSummary: `Local CNC cockpit UAT fixture: ${item.kind}`,
      requestedBy: 'local-cnc-cockpit-uat',
    }
    const proposalResult = await mutate<typeof proposalInput, { proposalId: string; created: boolean }>('companies:upsertIndustryProposal', proposalInput)
    if (proposalResult.proposalId !== proposalId) fail(`${proposalId}: Convex coalesced a different proposal ${proposalResult.proposalId}`)
    for (const source of item.sources) {
      const sourceInput = {
        ...secretArgs,
        sourceId: source.sourceId,
        ...(localCompanyKey ? { companyKey: localCompanyKey } : {}),
        proposalId,
        url: source.url,
        sourceType: source.sourceType,
        trustTier: source.trustTier,
        ...(source.title !== undefined ? { title: source.title } : {}),
        ...(source.evidenceExcerpt !== undefined ? { evidenceExcerpt: source.evidenceExcerpt } : {}),
        fetchStatus: source.fetchStatus,
        suggestedIndustryClass: source.suggestedIndustryClass ?? item.suggestedIndustryClass,
        workerConfidence: source.fetchStatus === 'fetched' ? 0.98 : 0.1,
      }
      await mutate<typeof sourceInput, unknown>('companies:upsertIndustryEvidenceSource', sourceInput)
    }
    const stateInput = {
      ...secretArgs,
      proposalId,
      status: 'ready_for_review' as const,
      suggestedIndustryClass: item.suggestedIndustryClass,
      suggestedVerificationLevel: 'candidate' as const,
      materialChangeSummary: `Local CNC cockpit UAT fixture: ${item.kind}`,
    }
    const stateResult = await mutate<typeof stateInput, { status: string }>('companies:setIndustryProposalResearchState', stateInput)
    setupResults.push({ caseId: item.id, proposalId, ...(localCompanyKey ? { localCompanyKey } : {}), created: proposalResult.created, status: stateResult.status })
  }

  const state: UatState = {
    schemaVersion: 'industry-review-uat-state.v1',
    namespace: fixture.namespace,
    workspaceSlug: options.workspaceSlug,
    fixturePath: options.fixturePath,
    manualApprovalCase,
    localCompanyKeys,
    before: { capturedAt: Date.now(), coverage: coverageBefore, cases: beforeCases },
  }
  mkdirSync(dirname(options.stateFile), { recursive: true })
  writeFileSync(options.stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    mode: 'local-write-namespaced',
    convexUrl,
    namespace: fixture.namespace,
    manualApprovalCase,
    stateFile: options.stateFile,
    setupResults,
    mutationsAttempted: setupResults.length + fixture.cases.reduce((count, item) => count + item.sources.length, 0),
  }, null, 2)}\n`)
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
