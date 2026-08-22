import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { chromium } from 'playwright'
import { authenticateRole } from '../run-multi-role-uat'

type UatState = {
  namespace: string
  manualApprovalCase: string
  localCompanyKeys: Record<string, string>
}

type CliOptions = {
  baseUrl: string
  stateFile: string
  storageState?: string
  workspace: string
}

function fail(message: string): never {
  throw new Error(message)
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    baseUrl: 'http://localhost:5173',
    stateFile: resolve('tmp/industry-review/cnc-cockpit-uat-before.json'),
    workspace: 'hr',
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
    else fail(`unknown option ${arg}`)
  }
  return options
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  if (!existsSync(options.stateFile)) fail(`missing local UAT state file ${options.stateFile}`)
  const state = JSON.parse(readFileSync(options.stateFile, 'utf8')) as UatState
  const companyKey = state.localCompanyKeys[state.manualApprovalCase]
  if (!companyKey) fail(`manual approval case ${state.manualApprovalCase} has no local company key`)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext(options.storageState ? { storageState: options.storageState } : undefined)
  const page = await context.newPage()

  if (!options.storageState) {
    await authenticateRole(page, 'uat-reviewer', options.baseUrl)
  }

  const approveRequests: string[] = []
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  await page.route('**/api/company-industry-proposals/*/approve', async (route) => {
    approveRequests.push(route.request().url())
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, code: 'INDUSTRY_REVIEW_UAT_APPROVAL_INTERCEPTED' }),
    })
  })

  try {
    const response = await page.goto(`${options.baseUrl}/${options.workspace}/system/settings/industry-verification?proposalId=${encodeURIComponent(`${state.namespace}/${state.manualApprovalCase.slice(state.namespace.length + 1)}`)}`, { waitUntil: 'networkidle' })
    if (!response || response.status() >= 400) fail(`reviewer cockpit route returned ${response?.status() ?? 'no response'}`)
    const companiesResponse = await page.request.get(`${options.baseUrl}/api/companies`, { headers: { 'X-Workspace-Slug': options.workspace } })
    if (!companiesResponse.ok()) fail(`company registry request returned ${companiesResponse.status()}`)
    const companies = await companiesResponse.json() as { items?: Array<{ companyKey: string; displayName: string }> }
    const company = companies.items?.find((item) => item.companyKey === companyKey)
    if (!company) fail(`local company ${companyKey} is not visible to the authenticated browser`)

    const proposalId = `${state.namespace}/${state.manualApprovalCase.slice(state.namespace.length + 1)}`
    const queueButton = page.locator(`[data-testid="industry-review-row-${proposalId}"] button`).first()
    await queueButton.waitFor({ state: 'visible', timeout: 15_000 })
    await queueButton.click()
    const attestation = page.getByTestId('industry-review-risk-attestation')
    await attestation.waitFor({ state: 'visible', timeout: 15_000 })
    const cncCheckboxCount = await attestation.getByRole('checkbox', { name: /CNC/i }).count()
    if (cncCheckboxCount !== 1) fail(`expected one explicit-CNC acknowledgement checkbox, found ${cncCheckboxCount}`)
    const checkbox = attestation.getByRole('checkbox', { name: /CNC/i })
    if (await checkbox.isDisabled()) fail('explicit-CNC acknowledgement checkbox is disabled despite explicit evidence')
    await checkbox.check()
    await page.getByRole('button', { name: /^Approve revision$/ }).click()
    await page.getByTestId('industry-review-approval-confirmation').waitFor({ state: 'visible', timeout: 5_000 })
    if (approveRequests.length !== 0) fail('approval endpoint was reached before the attended final confirmation click')
    const confirmation = await page.getByTestId('industry-review-approval-confirmation').innerText()
    if (!confirmation.includes('cnc')) fail('confirmation did not show the CNC verdict')
    const unnamedControlDetails = await page.locator('button, input, select, textarea').evaluateAll((elements) => elements.filter((element) => {
      const html = element as HTMLInputElement
      if (html.type === 'hidden') return false
      return !(html.getAttribute('aria-label') || html.getAttribute('name') || element.textContent?.trim())
    }).map((element) => element.outerHTML.slice(0, 240)))
    const unnamedControls = unnamedControlDetails.length
    if (unnamedControls > 0) fail(`found ${unnamedControls} unnamed interactive controls in the attended checkpoint: ${unnamedControlDetails.join(' | ')}`)
    if (consoleErrors.length > 0) fail(`browser console errors: ${consoleErrors.join(' | ')}`)
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 'industry-review-browser-uat.v1',
      status: 'passed',
      mode: 'confirmation-only-approval-intercepted',
      namespace: state.namespace,
      manualApprovalCase: state.manualApprovalCase,
      explicitCncCheckpointVisible: true,
      approvalRequestsIntercepted: approveRequests.length,
      unnamedControls,
      consoleErrors: consoleErrors.length,
    }, null, 2)}\n`)
  } finally {
    await context.close()
    await browser.close()
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
