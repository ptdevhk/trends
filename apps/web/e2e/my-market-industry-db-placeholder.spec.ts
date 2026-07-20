import { expect, test, type Page } from '@playwright/test'
import {
  buildResumeAnalysisLookupKeys,
  getCurrentResumeAiPromptVersion,
  parseKeywordQuery,
} from '@trends/shared'

/**
 * E2E test for MY market industry DB floor scoring.
 * Verifies that Malaysian resumes use the industry_db floor (40)
 * and render the normal breakdown bar (no placeholder).
 * Also locks the rendered numeric MY score contract (gap #1).
 */

const MY_SCORE_QUERY = 'CNC Sales'
const MY_SCORE_KEYWORDS = parseKeywordQuery(MY_SCORE_QUERY).keywords
const MY_SCORE_PROMPT_VERSION = getCurrentResumeAiPromptVersion()
const MY_SCORE_ANALYSIS_LOOKUP_KEYS = buildResumeAnalysisLookupKeys(
  undefined,
  MY_SCORE_KEYWORDS,
  { sourceKey: 'seek' },
)

const MY_SCORED_ANALYSIS = {
  score: 79,
  summary: 'MY seek CNC sales candidate with domain-relevant experience.',
  highlights: ['CNC sales experience'],
  recommendation: 'match',
  concerns: [],
  analyzedAt: Date.now(),
  promptVersion: MY_SCORE_PROMPT_VERSION,
  breakdown: {
    related_exp: 78,
    industry_db: 0,
  },
}

const MY_RESUME_MOCK = {
  _id: 'resume-my-test-001',
  _creationTime: Date.now(),
  externalId: 'ext-my-001',
  content: {
    name: 'Ahmad Bin Ismail',
    location: 'Penang, Malaysia',
    experience: '8 years',
    education: 'Bachelor',
    selfIntro: 'Experienced CNC sales engineer in Penang manufacturing zone.',
    workHistory: [
      { companyName: 'SMT Industries Sdn Bhd', jobTitle: 'Sales Engineer', raw: '5 years CNC sales' },
    ],
  },
  source: 'hk.employer.seek.com',
  sourceKey: 'seek',
  hash: 'mock-hash-my-001',
  crawledAt: Date.now(),
  tags: [],
  ingestData: {
    market: 'MY',
    industryTags: ['Machine Tools', 'Sales'],
    synonymHits: [],
    brandHits: [],
    companyHits: [],
    industryDbV2Raw: 0,
    industryDbV2RawComponents: {
      companyScore: 0,
      brandScore: 0,
      weightedBrandUnits: 0,
      uniqueCompanies: 0,
      brandUnitCount: 0,
    },
    ruleScores: {},
    experienceLevel: 'senior',
    computedAt: Date.now(),
    skillsVersion: 1,
  },
  primaryRuleScore: 55,
}

/** Same MY fixture + pre-seeded analysis for the rendered-score contract. */
const MY_SCORED_RESUME_MOCK = {
  ...MY_RESUME_MOCK,
  _id: 'resume-my-scored-001',
  externalId: 'ext-my-scored-001',
  hash: 'mock-hash-my-scored-001',
  analysis: MY_SCORED_ANALYSIS,
  analyses: Object.fromEntries(
    MY_SCORE_ANALYSIS_LOOKUP_KEYS.map((key) => [key, MY_SCORED_ANALYSIS]),
  ),
}

const CN_RESUME_MOCK = {
  ...MY_RESUME_MOCK,
  _id: 'resume-cn-test-001',
  externalId: 'ext-cn-001',
  source: 'hr.job5156.com',
  sourceKey: 'job5156',
  ingestData: {
    market: 'CN',
    industryTags: ['机械', '销售'],
    synonymHits: [],
    brandHits: [{ brand: 'Fanuc', role: 'employer', source: 'workHistory', context: 'employer' }],
    companyHits: ['Fanuc'],
    industryDbV2Raw: 20,
    industryDbV2RawComponents: {
      companyScore: 10,
      brandScore: 10,
      weightedBrandUnits: 1,
      uniqueCompanies: 1,
      brandUnitCount: 1,
    },
    ruleScores: {},
    experienceLevel: 'senior',
    computedAt: Date.now(),
    skillsVersion: 1,
  },
  primaryRuleScore: 70,
}

async function mockAuthenticatedDevShell(page: Page) {
  await page.addInitScript(() => {
    document.cookie = 'trends_csrf=csrf-e2e; path=/; SameSite=Lax'
    localStorage.setItem('i18nextLng', 'en')
  })

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        user: {
          id: 'dev-admin-e2e',
          email: 'dev-admin-e2e@example.com',
          displayName: 'Dev Admin E2E',
          status: 'active',
        },
        memberships: [{ userId: 'dev-admin-e2e', workspaceSlug: 'dev', role: 'admin' }],
        workspaceRole: 'admin',
      }),
    })
  })

  await page.route('**/api/config/resume-field-usage-policy', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        source: 'system',
        policy: {
          version: 1,
          fields: {},
          updatedAt: '2026-07-05T00:00:00.000Z',
        },
      }),
    })
  })

  await page.route('**/api/industry/brand-display-map', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  })
}

async function mockResumePageApis(page: Page, resumes: unknown[]) {
  await mockAuthenticatedDevShell(page)

  await page.addInitScript((payload) => {
    localStorage.setItem('i18nextLng', 'en')
    ;(window as Window & { __TR_PLAYWRIGHT_MOCK_RESUMES__?: unknown }).__TR_PLAYWRIGHT_MOCK_RESUMES__ = payload
  }, {
    list: resumes,
    search: {
      results: resumes.map((resume: unknown) => ({ resume })),
      expansion: undefined,
    },
  })

  await page.route('**/api/query', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'success', value: [] }),
    })
  })

  await page.route('**/api/mutation', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'success', value: null }),
    })
  })
}

test.describe('MY market industry DB floor scoring', () => {
  test('does not show "Not available" placeholder for MY resumes — floor applies', async ({ page }) => {
    await mockResumePageApis(page, [MY_RESUME_MOCK])
    await page.goto('/dev/resumes?q=CNC%20Sales')

    // With industry_db floor of 40, the placeholder should not appear
    const placeholder = page.getByText(/Not available for MY market/i)
    await expect(placeholder).not.toBeVisible({ timeout: 15000 })
  })

  test('does not show MY placeholder for CN market resumes', async ({ page }) => {
    await mockResumePageApis(page, [CN_RESUME_MOCK])
    await page.goto('/dev/resumes?q=CNC%20Sales')

    // The MY market placeholder should NOT appear for CN resumes
    const placeholder = page.getByText(/Not available for MY market/i)
    await expect(placeholder).not.toBeVisible({ timeout: 15000 })
  })

  test('MY resume still shows industry tags from keyword matching', async ({ page }) => {
    await mockResumePageApis(page, [MY_RESUME_MOCK])
    await page.goto('/dev/resumes?q=CNC%20Sales')

    // Industry tags from keyword matching should still render (exact: filter chips also match loosely)
    const tag = page.getByText('Machine Tools', { exact: true })
    await expect(tag.first()).toBeVisible({ timeout: 15000 })
  })

  test('renders MY composite score 79 for related_exp 78 with industry_db floor 40', async ({ page }) => {
    // Locks: round(related_exp * 0.5) + MY floor 40 → 39 + 40 = 79
    // Seed analysis.breakdown.related_exp=78 + recommendation=match (ceiling 100).
    // overrideIndustryDbBreakdown applies MY floor and recomputes score on render.
    // /dev/resumes search results use SnippetCard (not ResumeCard); assert on score text.
    await mockResumePageApis(page, [MY_SCORED_RESUME_MOCK])
    await page.goto(`/dev/resumes?q=${encodeURIComponent(MY_SCORE_QUERY)}`)

    await expect(page.getByText('Ahmad Bin Ismail')).toBeVisible({ timeout: 15000 })
    // EN locale scoreLabel is "{{score}} pts" — visible next to AI badge
    await expect(page.getByText(/79\s*pts/i)).toBeVisible()
  })
})
