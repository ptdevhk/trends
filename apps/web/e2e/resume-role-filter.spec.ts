import { expect, test, type Page } from '@playwright/test'
import type { Doc } from '../../../packages/convex/convex/_generated/dataModel'

type MockResume = Doc<'resumes'>

function countNonEngineerCards(roleTypes: Array<string | null>): number {
  return roleTypes.filter((value) => {
    if (!value) {
      return true
    }

    const types = value
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0)

    return !types.includes('engineer')
  }).length
}

function parseConvexBody(route: Parameters<Page['route']>[1] extends (route: infer T) => unknown ? T : never) {
  return route.request().postDataJSON() as { path?: string; args?: Record<string, unknown> }
}

async function mockResumePageApis(
  page: Page,
  options: {
    listResumes?: MockResume[]
    searchResumes?: MockResume[]
    jobDescriptionRoleType?: string
    jobDescriptionMinYears?: number
  }
) {
  await page.addInitScript((payload) => {
    localStorage.setItem('i18nextLng', 'zh-Hans')
    ;(window as Window & { __TR_PLAYWRIGHT_MOCK_RESUMES__?: unknown }).__TR_PLAYWRIGHT_MOCK_RESUMES__ = payload
  }, {
    list: options.listResumes ?? [],
    search: {
      results: (options.searchResumes ?? []).map((resume) => ({ resume })),
      expansion: undefined,
    },
  })

  await page.route('**/api/query', async (route) => {
    const body = parseConvexBody(route)
    const path = body.path ?? ''

    if (path === 'job_descriptions:list') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', value: [] }),
      })
      return
    }

    if (path === 'job_descriptions:get') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', value: null }),
      })
      return
    }

    if (path === 'sessions:getActiveSession') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', value: null }),
      })
      return
    }

    if (path === 'analysis_tasks:list' || path === 'sessions:listSearchHistory') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', value: [] }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'success', value: null }),
    })
  })

  await page.route('**/api/mutation', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'success',
        value: null,
      }),
    })
  })

  await page.route('**/api/resumes/keyword-expansion**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        summary: {
          groups: [],
          mode: 'AND',
          expandedTo: [],
          sourceMapping: {},
        },
      }),
    })
  })

  await page.route('**/api/search-profiles/auto-match', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        confidence: 0,
        matchedKeywords: [],
      }),
    })
  })

  await page.route('**/api/job-descriptions', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, items: [] }),
    })
  })

  await page.route('**/api/job-descriptions/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        item: {
          requiredRoles: options.jobDescriptionRoleType
            ? [{ type: options.jobDescriptionRoleType, min_years: options.jobDescriptionMinYears ?? 1 }]
            : [],
        },
      }),
    })
  })

  await page.route('**/api/actions**', async (route) => {
    const method = route.request().method()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        method === 'GET'
          ? { success: true, actions: [] }
          : { success: true, action: null }
      ),
    })
  })

  await page.route('**/api/blocks**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, items: [] }),
    })
  })

  await page.route('**/api/candidate-status**', async (route) => {
    const method = route.request().method()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        method === 'GET'
          ? { success: true, items: [] }
          : { success: true, item: null }
      ),
    })
  })
}

const engineerResume: MockResume = {
  _id: 'resume_1',
  identityKey: 'resume_1',
  externalId: 'hr.job5156.com:resume:987654',
  source: 'hr.job5156.com',
  tags: ['销售工程师'],
  crawledAt: 1710205323000,
  primaryRuleScore: 91,
  ingestData: {
    industryTags: ['machinery', 'sales'],
    synonymHits: ['machine tools'],
    brandHits: [
      {
        brand: 'haas',
        role: 'sales engineer',
        source: 'workHistory',
        context: 'project',
      },
    ],
    companyHits: ['haas'],
    roleSignals: [
      {
        type: 'engineer',
        matchedSignals: ['sales engineer', 'cnc', 'machine tools'],
        signalCount: 3,
        occurrences: 2,
        years: 4,
        industryVerifiedYears: 4,
        roleRelevantYears: 4,
        industryVerifiedRelevantYears: 4,
        matchedWorkEntries: [
          {
            companyName: '东莞某设备公司',
            jobTitle: '销售工程师',
            years: 4,
            industryVerified: true,
            matchedSignals: ['sales engineer', 'cnc', 'machine tools'],
          },
        ],
        verifyIn: 'workHistory',
      },
    ],
    ruleScores: { industry: 88, role: 92 },
    experienceLevel: 'senior',
    computedAt: 1710205323000,
    skillsVersion: 2,
  },
  content: {
    name: '李先生',
    profileUrl: 'https://hr.job5156.com/resume/view/987654',
    activityStatus: '在线中',
    age: '34岁',
    experience: '11年',
    education: '本科',
    location: '东莞',
    selfIntro: '多年机床与自动化设备销售经验，熟悉华南客户开发。',
    jobIntention: '销售工程师',
    expectedSalary: '15000-20000元/月',
    workHistory: [
      {
        raw: '2021-03~至今(4年)东莞某设备公司销售工程师\n负责华南区机床销售与客户维护',
        companyName: '东莞某设备公司',
        jobTitle: '销售工程师',
        startDate: '2021-03',
        endDate: '至今',
        description: '负责华南区机床销售与客户维护。\n离职原因：寻求更大平台。',
      },
    ],
    extractedAt: '2026-03-12T01:02:03.000Z',
    resumeId: '987654',
    perUserId: '123456',
  },
}

const salesResume: MockResume = {
  _id: 'resume_2',
  identityKey: 'resume_2',
  externalId: 'hr.job5156.com:resume:888888',
  source: 'hr.job5156.com',
  tags: ['销售助理'],
  crawledAt: 1710205323000,
  primaryRuleScore: 35,
  ingestData: {
    industryTags: ['sales'],
    synonymHits: [],
    brandHits: [],
    companyHits: [],
    roleSignals: [
      {
        type: 'sales',
        matchedSignals: ['sales'],
        signalCount: 1,
        occurrences: 1,
        years: 1,
        industryVerifiedYears: 0,
        roleRelevantYears: 1,
        industryVerifiedRelevantYears: 0,
        matchedWorkEntries: [
          {
            companyName: '东莞某贸易公司',
            jobTitle: '销售助理',
            years: 1,
            industryVerified: false,
            matchedSignals: ['sales'],
          },
        ],
        verifyIn: 'workHistory',
      },
    ],
    ruleScores: { industry: 40, role: 35 },
    experienceLevel: 'junior',
    computedAt: 1710205323000,
    skillsVersion: 2,
  },
  content: {
    name: '王女士',
    profileUrl: 'https://hr.job5156.com/resume/view/888888',
    activityStatus: '3日内活跃',
    age: '29岁',
    experience: '5年',
    education: '大专',
    location: '东莞',
    selfIntro: '具备基础销售支持经验。',
    jobIntention: '销售助理',
    expectedSalary: '8000-10000元/月',
    workHistory: [
      {
        raw: '2022-01~至今(3年)东莞某贸易公司销售助理',
      },
    ],
    extractedAt: '2026-03-12T01:02:03.000Z',
    resumeId: '888888',
    perUserId: '654321',
  },
}

test.describe('Resume quick role filter', () => {
  test('engineer role filter keeps only engineer-tagged resumes', async ({ page }) => {
    await mockResumePageApis(page, {
      listResumes: [engineerResume, salesResume],
      jobDescriptionRoleType: 'engineer',
      jobDescriptionMinYears: 1,
    })

    await page.goto('/dev/resumes?location=%E5%B9%BF%E4%B8%9C&jd=senior-mechanical-engineer')

    const cards = page.getByTestId('resume-card')
    await expect(cards).toHaveCount(1)
    await expect(page.getByText('李先生')).toBeVisible()

    const nonEngineerAfter = countNonEngineerCards(await cards.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-role-types'))
    ))

    expect(nonEngineerAfter).toBe(0)
  })

  test('enriched screening sample keeps evidence visible in card and detail views', async ({ page }) => {
    await mockResumePageApis(page, {
      searchResumes: [engineerResume, salesResume],
    })

    await page.goto('/dev/resumes?keyword=%E9%94%80%E5%94%AE%E5%B7%A5%E7%A8%8B%E5%B8%88')

    const cards = page.getByTestId('resume-card')
    await expect(cards).toHaveCount(2)
    await expect(cards.first().getByText('machinery')).toBeVisible()
    await expect(cards.first().getByText('sales')).toBeVisible()
    await expect(page.getByText('工程4年(行业验证)')).toBeVisible()
    await expect(page.getByText(/哈斯 · project/i)).toBeVisible()
    await expect(page.getByText(/东莞某设备公司.*销售工程师/)).toBeVisible()

    await page.getByRole('button', { name: '查看' }).first().click()
    const detailDialog = page.getByRole('dialog', { name: '简历详情' })
    await expect(detailDialog).toBeVisible()
    await expect(detailDialog.getByText('东莞某设备公司 · 销售工程师')).toBeVisible()
    await expect(detailDialog.getByText('2021-03 ~ 至今 (4年)')).toBeVisible()
    await expect(detailDialog.getByText('负责华南区机床销售与客户维护。 离职原因：寻求更大平台。')).toBeVisible()
    await expect(detailDialog.getByText('行业验证')).toBeVisible()
    await expect(detailDialog.getByText('machine tools')).toBeVisible()
    await page.getByRole('button', { name: '关闭' }).click()

    await page.goto('/dev/resumes?keyword=%E9%94%80%E5%94%AE%E5%B7%A5%E7%A8%8B%E5%B8%88&minRoleYears=1&roleType=engineer')

    await expect(cards).toHaveCount(1)
    await expect(page.getByText('李先生')).toBeVisible()
    await expect(page.getByText('王女士')).toHaveCount(0)
  })
})

