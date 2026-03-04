import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium } from 'playwright'

type Scenario = {
  name: string
  query: Record<string, string | undefined>
  expectedKeyword: string
}

type ScenarioResult = {
  inputValue: string
  status: string | null
  attrKeyword: string | null
  clicks: number
}

const KEYWORD = 'CNC 车床 销售 STAR'

const scenarios: Scenario[] = [
  {
    name: 'storage concat strips spaces',
    query: {
      keyword: KEYWORD,
      mock_storage_mode: 'concat',
    },
    expectedKeyword: 'CNC车床销售STAR',
  },
  {
    name: 'url spaced overrides storage concat',
    query: {
      keyword: KEYWORD,
      tr_kw_mode: 'spaced',
      mock_storage_mode: 'concat',
    },
    expectedKeyword: 'CNC 车床 销售 STAR',
  },
  {
    name: 'url concat overrides storage spaced',
    query: {
      keyword: KEYWORD,
      tr_kw_mode: 'concat',
      mock_storage_mode: 'spaced',
    },
    expectedKeyword: 'CNC车床销售STAR',
  },
  {
    name: 'storage spaced preserves spaces when url mode is absent',
    query: {
      keyword: KEYWORD,
      mock_storage_mode: 'spaced',
    },
    expectedKeyword: 'CNC 车床 销售 STAR',
  },
  {
    name: 'default mode is concat when no url mode and no storage mode',
    query: {
      keyword: KEYWORD,
    },
    expectedKeyword: 'CNC车床销售STAR',
  },
]

function resolveRepoRoot(): string {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(scriptDir, '..')
}

function buildHarnessUrl(harnessPath: string, query: Record<string, string | undefined>): string {
  const url = new URL(pathToFileURL(harnessPath).toString())
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string' && value.length > 0) {
      url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

async function runScenario(contentScriptPath: string, harnessPath: string, scenario: Scenario): Promise<void> {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const harnessUrl = buildHarnessUrl(harnessPath, scenario.query)

    await page.goto(harnessUrl, { waitUntil: 'domcontentloaded' })
    await page.addScriptTag({ path: contentScriptPath })

    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-tr-auto-search') === 'done',
      { timeout: 10_000 },
    )

    const result = await page.evaluate<ScenarioResult>(() => {
      const input = document.querySelector('.el-autocomplete input.el-input__inner')
      const inputValue = input instanceof HTMLInputElement ? input.value : ''
      const status = document.documentElement.getAttribute('data-tr-auto-search')
      const attrKeyword = document.documentElement.getAttribute('data-tr-search-keyword')
      const raw = window as unknown as { __searchClicks?: number }
      const clicks = typeof raw.__searchClicks === 'number' ? raw.__searchClicks : 0

      return {
        inputValue,
        status,
        attrKeyword,
        clicks,
      }
    })

    assert.equal(result.status, 'done', `${scenario.name}: expected data-tr-auto-search=done`)
    assert.equal(result.clicks, 1, `${scenario.name}: expected one search click`)
    assert.equal(result.inputValue, scenario.expectedKeyword, `${scenario.name}: unexpected input value`)
    assert.equal(result.attrKeyword, scenario.expectedKeyword, `${scenario.name}: unexpected data-tr-search-keyword`)

    console.log(`PASS ${scenario.name}`)
  } finally {
    await browser.close()
  }
}

async function main(): Promise<void> {
  const repoRoot = resolveRepoRoot()
  const contentScriptPath = path.join(repoRoot, 'apps', 'browser-extension', 'content.js')
  const harnessPath = path.join(repoRoot, 'scripts', 'fixtures', 'extension-keyword-mode-harness.html')

  for (const scenario of scenarios) {
    await runScenario(contentScriptPath, harnessPath, scenario)
  }

  console.log('All keyword mode scenarios passed.')
}

main().catch((error: unknown) => {
  console.error('Extension keyword mode regression test failed.')
  console.error(error)
  process.exit(1)
})
