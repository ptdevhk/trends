import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { chromium } from 'playwright'
import { ConvexHttpClient } from 'convex/browser'

const NAMESPACE = 'cnc-cockpit-uat'
const CLEAN_CASE = `${NAMESPACE}/clean-standard`
const CLEAN_COMPANY = 'uat-clean-standard-co'
const RISK_CASES = [
  `${NAMESPACE}/explicit-cnc`,
  `${NAMESPACE}/keyword-only`,
  `${NAMESPACE}/discovery-only`,
  `${NAMESPACE}/stale-source`,
  `${NAMESPACE}/conflict`,
  `${NAMESPACE}/missing-canonical`,
  `${NAMESPACE}/worker-failure`,
]

type UatState = {
  namespace: string
  workspaceSlug: string
  localCompanyKeys: Record<string, string>
}

type CliOptions = {
  baseUrl: string
  stateFile: string
  storageState?: string
  workspace: string
  convexUrl: string
}

type LocalProposal = { proposalId: string; companyKey?: string; status: string }
type LocalRevision = {
  revisionId: string
  proposalId?: string
  supersedesRevisionId?: string
  createdAt: number
}
type LocalRecomputeRun = { runId: string; proposalId?: string; targetRevisionId: string; status: string; updatedAt: number }

function fail(message: string): never {
  throw new Error(message)
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    baseUrl: 'http://localhost:5173',
    stateFile: resolve('tmp/industry-review/cnc-cockpit-uat-before.json'),
    workspace: 'dev',
    convexUrl: 'http://127.0.0.1:3210',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) fail(`missing value for ${arg}`)
      index += 1
      return value
    }
    if (arg === '--base-url') options.baseUrl = next().replace(/\/$/, '')
    else if (arg === '--state-file') options.stateFile = resolve(next())
    else if (arg === '--storage-state') options.storageState = resolve(next())
    else if (arg === '--workspace') options.workspace = next()
    else if (arg === '--convex-url') options.convexUrl = next()
    else fail(`unknown option ${arg}`)
  }
  return options
}

async function assertSessionCount(page: import('playwright').Page, testId: string, expected: string): Promise<void> {
  const element = page.getByTestId(testId)
  await element.waitFor({ state: 'visible', timeout: 15_000 })
  const text = (await element.innerText()).trim()
  if (text !== expected) fail(`expected ${testId} to read ${expected}, found ${text}`)
}

// The detail area renders as a section of cards (header, evidence, decision);
// opening a row replaces the empty state with the proposal header card.
async function assertDetailOpened(page: import('playwright').Page): Promise<void> {
  await page.getByTestId('industry-review-detail-section').waitFor({ state: 'visible', timeout: 15_000 })
  await page.getByText(/select a proposal to review its evidence/i).waitFor({ state: 'detached', timeout: 15_000 })
  await page.getByText('Current verdict', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
}

type ProposalWithApproval = {
  proposalId: string
  status: string
  approvedRevisionId?: string
  recomputeRunId?: string
  updatedAt: number
}

// The desktop flow approves + refreshes the clean row into history, so the
// mobile walk needs the proposal restored to pending first. Direct Convex
// undo (no BFF) mirrors tmp/industry-review/reset-clean-standard.ts; the BFF
// undo path itself is covered by the desktop and mobile UI undo steps.
async function restoreCleanStandardPending(convex: ConvexHttpClient, writeSecret: string): Promise<void> {
  const proposals = (await convex.query('companies:listIndustryProposals', { writeSecret })) as ProposalWithApproval[]
  const proposal = proposals.find((item) => item.proposalId === CLEAN_CASE)
  if (!proposal) fail(`${CLEAN_CASE} proposal missing before mobile step`)
  if (proposal.status !== 'approved') {
    process.stderr.write(`mobile prep: ${CLEAN_CASE} already ${proposal.status} — skipping reset undo\n`)
  } else {
    const result = (await convex.mutation('companies:undoIndustryProposalApproval', {
      writeSecret,
      proposalId: CLEAN_CASE,
      approvedRevisionId: proposal.approvedRevisionId,
      expectedProposalUpdatedAt: proposal.updatedAt,
      recomputeRunId: proposal.recomputeRunId,
      reviewer: 'uat-mobile-prep',
      reviewerRole: 'admin',
    })) as { reversalRevisionId?: string }
    const after = (await convex.query('companies:listIndustryProposals', { writeSecret })) as ProposalWithApproval[]
    const status = after.find((item) => item.proposalId === CLEAN_CASE)?.status
    if (status !== 'ready_for_review') fail(`mobile prep reset left ${CLEAN_CASE} as ${status}`)
    process.stderr.write(`mobile prep: reset undo ${result.reversalRevisionId ?? '<none>'} → ${status}\n`)
  }
  // The BFF review-queue index is cached with a 15s TTL
  // (REVIEW_INDEX_CACHE_TTL_MS in company-industry-review-index.ts) and this
  // direct-Convex undo bypasses the BFF invalidation, so the last desktop-flow
  // queue fetch can still hide the restored row. Wait out the TTL before the
  // mobile page's mount fetch to guarantee a fresh index.
  await new Promise((resolveWait) => setTimeout(resolveWait, 16_000))
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  if (!existsSync(options.stateFile)) fail(`missing local UAT state file ${options.stateFile}`)
  const state = JSON.parse(readFileSync(options.stateFile, 'utf8')) as UatState
  if (state.namespace !== NAMESPACE) fail(`state file namespace ${state.namespace} does not match ${NAMESPACE}`)
  if (state.localCompanyKeys[CLEAN_CASE] !== CLEAN_COMPANY) {
    fail(`clean-standard must map to ${CLEAN_COMPANY}; state file has ${state.localCompanyKeys[CLEAN_CASE] ?? '<missing>'}`)
  }
  const writeSecret = process.env.CONVEX_WRITE_SECRET?.trim()
  if (!writeSecret) fail('CONVEX_WRITE_SECRET is required for final-state verification')

  const convex = new ConvexHttpClient(options.convexUrl)
  const browser = await chromium.launch({ headless: true })
  const consoleErrors: string[] = []
  const cockpitUrl = `${options.baseUrl}/${options.workspace}/system/settings/industry-verification`

  try {
    const context = await browser.newContext(options.storageState ? { storageState: options.storageState } : undefined)
    const page = await context.newPage()
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => consoleErrors.push(error.message))

    const response = await page.goto(cockpitUrl, { waitUntil: 'networkidle' })
    if (!response || response.status() >= 400) fail(`reviewer cockpit route returned ${response?.status() ?? 'no response'}`)

    // 1. Inbox default view: summary bar, all three filter tabs, live queue row.
    await page.getByTestId('industry-review-summary').waitFor({ state: 'visible', timeout: 20_000 })
    for (const slug of ['approvable', 'needs-review', 'history']) {
      await page.getByTestId(`industry-review-filter-${slug}`).waitFor({ state: 'visible', timeout: 10_000 })
    }
    await page.getByTestId(`industry-review-row-${CLEAN_CASE}`).waitFor({ state: 'visible', timeout: 20_000 })

    // 2. Clean row renders the one-click approve check; risk/CNC rows never do.
    const cleanApprove = page.getByTestId(`industry-review-approve-${CLEAN_CASE}`)
    await cleanApprove.waitFor({ state: 'visible', timeout: 15_000 })
    for (const caseId of RISK_CASES) {
      const count = await page.getByTestId(`industry-review-approve-${caseId}`).count()
      if (count !== 0) fail(`${caseId} must never render a one-click approve button`)
    }

    // 3. Keyboard path: focus + Enter approves the clean row.
    await cleanApprove.focus()
    await page.keyboard.press('Enter')
    await page.getByTestId(`industry-review-undo-${CLEAN_CASE}`).waitFor({ state: 'visible', timeout: 20_000 })
    await assertSessionCount(page, 'industry-review-summary-session-approved', '1')
    const announcement = (await page.getByTestId('industry-review-announcement').innerText()).toLowerCase()
    if (!announcement.includes('approved')) fail(`announcement did not report approval: ${announcement}`)
    const approvedRowText = await page.getByTestId(`industry-review-row-${CLEAN_CASE}`).innerText()
    if (!/已批准|approved/i.test(approvedRowText)) fail('approved row label missing')

    // 4. Undo restores the row to pending with the one-click check back.
    await page.getByTestId(`industry-review-undo-${CLEAN_CASE}`).click()
    await cleanApprove.waitFor({ state: 'visible', timeout: 20_000 })
    await assertSessionCount(page, 'industry-review-summary-session-approved', '0')

    // 5. Mouse path approves again (session count increments once more).
    await cleanApprove.click()
    await page.getByTestId(`industry-review-undo-${CLEAN_CASE}`).waitFor({ state: 'visible', timeout: 20_000 })
    await assertSessionCount(page, 'industry-review-summary-session-approved', '1')

    // 6. Refresh reconciles the approved row out of the live queue.
    await page.getByTestId('industry-review-refresh').click()
    await page.waitForFunction(
      () => document.querySelector('[data-testid="industry-review-announcement"]')?.textContent?.includes('Refresh complete') ?? false,
      undefined,
      { timeout: 20_000 },
    )
    if ((await page.getByTestId(`industry-review-row-${CLEAN_CASE}`).count()) !== 0) {
      fail('approved clean row still in live queue after refresh')
    }
    await assertSessionCount(page, 'industry-review-summary-session-approved', '0')

    // 7. Approvable partition is now genuinely empty (explicit empty state).
    await page.getByTestId('industry-review-filter-approvable').click()
    await page.getByTestId('industry-review-empty-approvable').waitFor({ state: 'visible', timeout: 15_000 })

    // 8. History shows the approved clean row; clicking it opens the detail section.
    await page.getByTestId('industry-review-filter-history').click()
    await page.getByTestId(`industry-history-row-${CLEAN_CASE}`).waitFor({ state: 'visible', timeout: 15_000 })
    await page.getByTestId(`industry-history-row-${CLEAN_CASE}`).click()
    await assertDetailOpened(page)

    // 9. Exception rows open the detail section instead of one-click controls.
    await page.getByTestId('industry-review-filter-needs-review').click()
    await page.getByTestId(`industry-review-row-${NAMESPACE}/keyword-only`).waitFor({ state: 'visible', timeout: 15_000 })
    await page.getByTestId(`industry-review-row-${NAMESPACE}/keyword-only`).click()
    await assertDetailOpened(page)

    // 10. Mobile viewport: approve then undo, leaving the proposal ready_for_review.
    await restoreCleanStandardPending(convex, writeSecret)
    const mobile = await browser.newContext({
      ...(options.storageState ? { storageState: options.storageState } : {}),
      viewport: { width: 390, height: 844 },
    })
    const mobilePage = await mobile.newPage()
    mobilePage.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    mobilePage.on('pageerror', (error) => consoleErrors.push(error.message))
    const mobileResponse = await mobilePage.goto(cockpitUrl, { waitUntil: 'networkidle' })
    if (!mobileResponse || mobileResponse.status() >= 400) fail(`mobile cockpit route returned ${mobileResponse?.status() ?? 'no response'}`)
    await mobilePage.getByTestId(`industry-review-row-${CLEAN_CASE}`).waitFor({ state: 'visible', timeout: 20_000 })
    const mobileApprove = mobilePage.getByTestId(`industry-review-approve-${CLEAN_CASE}`)
    await mobileApprove.waitFor({ state: 'visible', timeout: 15_000 })
    await mobileApprove.click()
    await mobilePage.getByTestId(`industry-review-undo-${CLEAN_CASE}`).waitFor({ state: 'visible', timeout: 20_000 })
    await mobilePage.getByTestId(`industry-review-undo-${CLEAN_CASE}`).click()
    await mobileApprove.waitFor({ state: 'visible', timeout: 20_000 })
    await mobile.close()

    // 11. Final-state verification: proposal restored, immutable trail shows
    // original + compensating revisions and approval + replacement runs.
    const proposals = await convex.query('companies:listIndustryProposals', { writeSecret }) as LocalProposal[]
    const cleanProposal = proposals.find((proposal) => proposal.proposalId === CLEAN_CASE)
    if (!cleanProposal) fail('clean-standard proposal missing from Convex after UAT')
    if (cleanProposal.status !== 'ready_for_review') {
      fail(`clean-standard must end ready_for_review (left ${cleanProposal.status})`)
    }
    const revisions = await convex.query('companies:listIndustryVerdictRevisions', { writeSecret, companyKey: CLEAN_COMPANY }) as LocalRevision[]
    const approvalRevisions = revisions.filter((revision) => !revision.revisionId.startsWith('undo-'))
    const reversalRevisions = revisions.filter((revision) => revision.revisionId.startsWith('undo-'))
    if (approvalRevisions.length < 3) fail(`expected >=3 approval revisions, found ${approvalRevisions.length}`)
    if (reversalRevisions.length < 2) fail(`expected >=2 compensating undo revisions, found ${reversalRevisions.length}`)
    for (const reversal of reversalRevisions) {
      if (!reversal.revisionId.startsWith(`undo-${approvalRevisions.some((approval) => approval.revisionId === reversal.revisionId.slice(5)) ? '' : '__unused__'}`)) {
        // Every reversal must reference an existing approval revision id.
        const target = reversal.revisionId.slice('undo-'.length)
        if (!revisions.some((revision) => revision.revisionId === target)) {
          fail(`reversal ${reversal.revisionId} has no matching approval revision`)
        }
      }
    }
    const runs = await convex.query('companies:listIndustryRecomputeRuns', { writeSecret, workspaceSlug: state.workspaceSlug, companyKey: CLEAN_COMPANY, limit: 50 }) as LocalRecomputeRun[]
    const runTargetIds = new Set(runs.map((run) => run.targetRevisionId))
    const approvalRun = runs.find((run) => approvalRevisions.some((revision) => revision.revisionId === run.targetRevisionId))
    const replacementRun = runs.find((run) => reversalRevisions.some((revision) => revision.revisionId === run.targetRevisionId))
    if (!approvalRun) fail('no recompute run targets an approval revision (approval-triggered run missing)')
    if (!replacementRun) fail('no recompute run targets a reversal revision (replacement run missing)')
    const approvalRunTargetCount = runs.filter((run) => runTargetIds.has(run.targetRevisionId) && approvalRevisions.some((revision) => revision.revisionId === run.targetRevisionId)).length
    if (approvalRunTargetCount < 2) fail(`expected >=2 approval-triggered runs, found ${approvalRunTargetCount}`)

    if (consoleErrors.length > 0) fail(`browser console errors: ${consoleErrors.join(' | ')}`)
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 'industry-review-browser-uat-clean.v2',
      status: 'passed',
      mode: 'live-mutations-restored',
      namespace: NAMESPACE,
      cleanCase: CLEAN_CASE,
      checks: {
        inboxDefaultView: true,
        oneClickApproveRendered: true,
        riskRowsNeverRenderOneClick: true,
        keyboardApprove: true,
        undoRestores: true,
        mouseApprove: true,
        refreshReconcilesToHistory: true,
        approvableEmptyState: true,
        historyRowOpensDetail: true,
        exceptionRowOpensDetail: true,
        mobilePrepResetViaConvex: true,
        mobileApproveAndUndo: true,
      },
      finalProposalStatus: cleanProposal.status,
      revisions: { approval: approvalRevisions.length, reversal: reversalRevisions.length },
      recomputeRuns: { total: runs.length, approvalTargeted: approvalRunTargetCount, replacementTargeted: true },
      consoleErrors: consoleErrors.length,
    }, null, 2)}\n`)
  } finally {
    await browser.close()
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
