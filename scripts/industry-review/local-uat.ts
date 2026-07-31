import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  hasExplicitCncEvidence,
  normalizeIndustryEvidenceUrl,
  type IndustryCncEvidenceCandidate,
} from '@trends/shared'

type FixtureSource = IndustryCncEvidenceCandidate & {
  sourceId: string
  url: string
  suggestedIndustryClass?: string
}

type FixtureCase = {
  id: string
  kind: string
  companyKey: string | null
  suggestedIndustryClass?: string
  sources: FixtureSource[]
  maintenance?: { lastFailed?: { runId: string; status?: string; operatorSummary?: string } }
  expected: {
    recommendedAction: string
    explicitCncEvidence: boolean
    approvalSafeSourceIds?: string[]
    riskFlags?: string[]
  }
}

type Fixture = {
  schemaVersion: string
  namespace: string
  cases: FixtureCase[]
}

function fail(message: string): never {
  throw new Error(message)
}

function readFixture(pathArg?: string): Fixture {
  const path = resolve(pathArg ?? 'scripts/industry-review/fixtures/cnc-review-cases.json')
  const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<Fixture>
  if (value.schemaVersion !== 'industry-review-uat.v1') fail(`unexpected fixture schema in ${path}`)
  if (!value.namespace || !value.namespace.endsWith('uat')) fail('fixture namespace must end with uat')
  if (!Array.isArray(value.cases) || value.cases.length < 7) fail('fixture must include all required UAT cases')
  return value as Fixture
}

function approvalSafeSourceIds(sources: FixtureSource[]): string[] {
  return sources
    .filter((source) => (
      normalizeIndustryEvidenceUrl(source.url) !== null &&
      source.sourceType !== 'search_result' &&
      source.trustTier !== 'discovery' &&
      source.fetchStatus === 'fetched' &&
      source.sourceState === 'active'
    ))
    .map((source) => source.sourceId)
}

function expectedAction(item: FixtureCase, explicitCncEvidence: boolean, safeIds: string[]): string {
  if (!item.companyKey) return 'inspect'
  if (item.kind === 'explicit_cnc' && explicitCncEvidence && safeIds.length > 0) return 'approve'
  return 'needs_more_evidence'
}

async function checkOptionalHealth(baseUrl: string | undefined): Promise<unknown> {
  if (!baseUrl) return { skipped: true, reason: 'no --base-url supplied; fixture UAT is offline and read-only' }
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/health`, { method: 'GET' })
  return { status: response.status, ok: response.ok }
}

async function main(): Promise<void> {
  const fixtureIndex = process.argv.indexOf('--fixture')
  const baseUrlIndex = process.argv.indexOf('--base-url')
  const fixturePath = fixtureIndex >= 0 ? process.argv[fixtureIndex + 1] : undefined
  const baseUrl = baseUrlIndex >= 0 ? process.argv[baseUrlIndex + 1] : undefined
  const fixture = readFixture(fixturePath)
  const seen = new Set<string>()
  const results = fixture.cases.map((item) => {
    if (!item.id.startsWith(`${fixture.namespace}/`)) fail(`case ${item.id} is outside the fixture namespace`)
    if (seen.has(item.id)) fail(`duplicate case ${item.id}`)
    seen.add(item.id)
    const sourceIds = new Set<string>()
    for (const source of item.sources) {
      if (!source.sourceId.startsWith(`${fixture.namespace}/`)) fail(`source ${source.sourceId} is outside the fixture namespace`)
      if (sourceIds.has(source.sourceId)) fail(`duplicate source ${source.sourceId}`)
      sourceIds.add(source.sourceId)
      if (!normalizeIndustryEvidenceUrl(source.url)) fail(`unsafe fixture URL ${source.url}`)
    }
    const explicitCncEvidence = hasExplicitCncEvidence(item.sources)
    const safeIds = approvalSafeSourceIds(item.sources)
    const action = expectedAction(item, explicitCncEvidence, safeIds)
    if (explicitCncEvidence !== item.expected.explicitCncEvidence) fail(`${item.id}: explicit CNC predicate mismatch`)
    if (action !== item.expected.recommendedAction) fail(`${item.id}: expected action ${item.expected.recommendedAction}, derived ${action}`)
    if (item.expected.approvalSafeSourceIds && JSON.stringify(safeIds) !== JSON.stringify(item.expected.approvalSafeSourceIds)) {
      fail(`${item.id}: approval-safe source projection mismatch`)
    }
    for (const riskFlag of item.expected.riskFlags ?? []) {
      if (riskFlag === 'cnc_claim_inferred' && explicitCncEvidence) fail(`${item.id}: inferred CNC risk cannot coexist with explicit evidence`)
      if (riskFlag === 'canonical_mapping_missing' && item.companyKey) fail(`${item.id}: canonical mapping risk requires no companyKey`)
    }
    return {
      id: item.id,
      kind: item.kind,
      explicitCncEvidence,
      approvalSafeSourceIds: safeIds,
      derivedRecommendedAction: action,
      expectedRiskFlags: item.expected.riskFlags ?? [],
    }
  })
  const health = await checkOptionalHealth(baseUrl)
  const report = {
    schemaVersion: fixture.schemaVersion,
    namespace: fixture.namespace,
    mode: 'local-read-only',
    mutationsAttempted: 0,
    liveHealth: health,
    cases: results,
    status: 'passed',
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
