import { expect, test, type Page } from '@playwright/test'

/**
 * E2E test for MY market industry DB graceful degradation.
 * Verifies that Malaysian resumes show a "Not available for MY market"
 * placeholder instead of an empty industry DB breakdown bar.
 */

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

async function mockResumePageApis(page: Page, resumes: unknown[]) {
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

test.describe('MY market industry DB placeholder', () => {
  test('shows "Not available for MY market" placeholder for Malaysian resumes', async ({ page }) => {
    await mockResumePageApis(page, [MY_RESUME_MOCK])
    await page.goto('/dev/resumes?q=CNC%20Sales')

    // The MY market placeholder should be visible in the expanded card
    const placeholder = page.getByText(/Not available for MY market/i)
    await expect(placeholder).toBeVisible({ timeout: 15000 })
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

    // Industry tags from keyword matching should still render
    const tag = page.getByText('Machine Tools')
    await expect(tag).toBeVisible({ timeout: 15000 })
  })
})
