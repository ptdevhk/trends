import { createHash } from 'node:crypto'

import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference, type DefaultFunctionArgs } from 'convex/server'

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

type CliOptions = {
  convexUrl: string
  workspaceSlug: string
  companyKey: string
  externalId: string
  timeoutMs: number
  pollIntervalMs: number
  allowLocalWrite: boolean
}

const defaultConvexUrl = 'http://127.0.0.1:3210'

function fail(message: string): never {
  throw new Error(message)
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    convexUrl: process.env.CONVEX_URL?.trim() || defaultConvexUrl,
    workspaceSlug: 'dev',
    companyKey: 'polywell',
    externalId: 'fixture.polywell.uat',
    timeoutMs: 180_000,
    pollIntervalMs: 3_000,
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
    if (arg === '--convex-url') options.convexUrl = next()
    else if (arg === '--workspace') options.workspaceSlug = next()
    else if (arg === '--company-key') options.companyKey = next()
    else if (arg === '--external-id') options.externalId = next()
    else if (arg === '--timeout-ms') options.timeoutMs = Number(next())
    else if (arg === '--poll-interval-ms') options.pollIntervalMs = Number(next())
    else if (arg === '--allow-local-write') options.allowLocalWrite = true
    else fail(`unknown option ${arg}`)
  }
  return options
}

// ---------------------------------------------------------------------------
// Guard helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

function queryRef<Args extends DefaultFunctionArgs, Result>(name: string) {
  return makeFunctionReference<'query', Args, Result>(name)
}

function mutationRef<Args extends DefaultFunctionArgs, Result>(name: string) {
  return makeFunctionReference<'mutation', Args, Result>(name)
}

// ---------------------------------------------------------------------------
// Fixture content
// ---------------------------------------------------------------------------

function buildFixtureContent(companyName: string): Record<string, unknown> {
  return {
    name: 'UAT Company-Linked Fixture',
    email: 'fixture.company-linked.uat@example.test',
    selfIntro: `CNC programmer with experience at ${companyName}.`,
    workHistory: [
      {
        companyName,
        jobTitle: 'CNC 编程',
        startDate: '2021-02',
        endDate: '2026-06',
        description: 'CNC programming, toolpath design and precision machining operations.',
      },
      {
        companyName: '示例贸易有限公司',
        jobTitle: '行政助理',
        startDate: '2019-08',
        endDate: '2021-01',
        description: 'Administrative support and document management.',
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  if (!options.allowLocalWrite) {
    fail('fixture setup is a local write; rerun with --allow-local-write')
  }
  const convexUrl = assertLocalConvexUrl(options.convexUrl)
  const writeSecret = process.env.CONVEX_WRITE_SECRET?.trim()
  if (!writeSecret) fail('CONVEX_WRITE_SECRET is required for local fixture setup')

  const client = new ConvexHttpClient(convexUrl)
  const query = <Args extends DefaultFunctionArgs, Result>(name: string, args: Args) =>
    client.query(queryRef<Args, Result>(name), args as never) as Promise<Result>
  const mutate = <Args extends DefaultFunctionArgs, Result>(name: string, args: Args) =>
    client.mutation(mutationRef<Args, Result>(name), args as never) as Promise<Result>
  const secretArgs = { writeSecret }

  // Build fixture content
  const content = buildFixtureContent(options.companyKey)
  const hash = createHash('sha256').update(JSON.stringify(content), 'utf8').digest('hex')

  process.stdout.write(JSON.stringify({
    phase: 'submit',
    convexUrl,
    externalId: options.externalId,
    companyKey: options.companyKey,
    workspaceSlug: options.workspaceSlug,
    hash,
    contentKeys: Object.keys(content),
  }, null, 2) + '\n')

  // Submit resume — no restoreState so shouldScheduleIngest fires
  const submitResult = await mutate<{
    resumes: Array<{
      externalId: string
      content: Record<string, unknown>
      hash: string
      source: string
      tags: string[]
    }>
  }, unknown>('resume_tasks:submitResumes', {
    resumes: [{
      externalId: options.externalId,
      content,
      hash,
      source: 'fixture-local-uat',
      tags: ['fixture', 'uat', 'company-linked'],
    }],
  })

  const submit = submitResult as { queued: boolean; reason?: string; input?: number }
  process.stdout.write(JSON.stringify({ phase: 'submit-result', submit }, null, 2) + '\n')

  if (!submit.queued) {
    fail(`submit was rejected: ${submit.reason ?? 'unknown'}`)
  }

  // Record baseline link count for this company
  const baselineLinks = await query<typeof secretArgs & { workspaceSlug: string; companyKey: string }, { items: Array<{ resumeIdentity: string }> }>(
    'company_resume_links:listAffectedResumesByCompany',
    { ...secretArgs, workspaceSlug: options.workspaceSlug, companyKey: options.companyKey, limit: 200 },
  )
  const baselineCount = baselineLinks.items.length
  const expectedIdentity = `externalId:${options.externalId}`

  process.stdout.write(JSON.stringify({
    phase: 'poll-start',
    baselineCount,
    expectedIdentity,
  }, null, 2) + '\n')

  // Poll for the new link with timeout
  const deadline = Date.now() + options.timeoutMs
  let found = false
  let lastItemCount = baselineCount
  let pollCount = 0

  while (Date.now() < deadline) {
    await sleep(options.pollIntervalMs)
    pollCount += 1

    const pollResult = await query<typeof secretArgs & { workspaceSlug: string; companyKey: string }, { items: Array<{ resumeIdentity: string }>; isDone: boolean }>(
      'company_resume_links:listAffectedResumesByCompany',
      { ...secretArgs, workspaceSlug: options.workspaceSlug, companyKey: options.companyKey, limit: 200 },
    )

    const newItems = pollResult.items.filter((item) => item.resumeIdentity === expectedIdentity)
    if (newItems.length > 0) {
      found = true
      process.stdout.write(JSON.stringify({
        phase: 'link-found',
        pollCount,
        totalItems: pollResult.items.length,
        newIdentifierCount: newItems.length,
        expectedIdentity,
      }, null, 2) + '\n')
      break
    }

    if (pollResult.items.length !== lastItemCount) {
      process.stdout.write(JSON.stringify({
        phase: 'poll-progress',
        pollCount,
        totalItems: pollResult.items.length,
        previousCount: lastItemCount,
      }, null, 2) + '\n')
      lastItemCount = pollResult.items.length
    }
  }

  if (!found) {
    fail(`timed out after ${options.timeoutMs}ms waiting for company_resume_links row with identity "${expectedIdentity}" (baseline=${baselineCount}, last=${lastItemCount})`)
  }

  process.stdout.write(JSON.stringify({
    phase: 'complete',
    status: 'passed',
    convexUrl,
    workspaceSlug: options.workspaceSlug,
    companyKey: options.companyKey,
    externalId: options.externalId,
    submitResult: submit,
    baselineCount,
    pollCount: pollCount + 1,
  }, null, 2) + '\n')
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})