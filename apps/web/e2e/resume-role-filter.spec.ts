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

  await page.route('**/api/industry/keywords**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [],
      }),
    })
  })

  await page.route('**/api/config/custom-keywords**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        tags: [],
        systemLocations: [],
      }),
    })
  })

  await page.route('**/api/industry/brands**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [],
      }),
    })
  })

  await page.route('**/api/industry/brand-display-map**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        haas: {
          displayName: 'Haas',
          zhHans: '哈斯',
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
  test('home navigation clears search state while direct links and legacy redirects still hydrate', async ({ page }) => {
    await mockResumePageApis(page, {
      searchResumes: [engineerResume, salesResume],
    })

    await page.goto('/resumes?location=%E4%B8%9C%E8%8E%9E&keyword=CNC+%E8%BD%A6%E5%BA%8A+%E9%94%80%E5%94%AE+STAR')

    const locationInput = page.getByRole('textbox', { name: '位置' })
    const keywordInput = page.getByPlaceholder('自定义关键词...')

    await expect(page).toHaveURL(/\/dev\/resumes\?location=.*keyword=/)
    await expect(locationInput).toHaveValue('东莞')
    await expect(keywordInput).toHaveValue('CNC 车床 销售 STAR')

    await page.getByRole('link', { name: '趋势 Trends' }).click()

    await expect(page).toHaveURL(/\/dev\/resumes$/)
    await expect(locationInput).toHaveValue('')
    await expect(keywordInput).toHaveValue('')

    await page.goBack()

    await expect(page).toHaveURL(/\/dev\/resumes\?location=.*keyword=/)
    await expect(locationInput).toHaveValue('东莞')
    await expect(keywordInput).toHaveValue('CNC 车床 销售 STAR')
  })

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
    await expect(cards.first().getByText('哈斯')).toHaveCount(2)
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

  test('SEEK Malaysia workflow keeps Kuala Lumpur as one location token and opens the correct collect URL', async ({ page }) => {
    await mockResumePageApis(page, {
      searchResumes: [],
    })

    await page.route('**/api/config/custom-keywords**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          tags: [
            { id: 'kw-sales-engineer', keyword: 'Sales Engineer', category: 'role' },
            { id: 'kw-sales-manager', keyword: 'Sales Manager', category: 'role' },
            { id: 'kw-kl-my', keyword: 'Kuala Lumpur MY', category: 'location' },
            { id: 'kw-malaysia', keyword: 'Malaysia', category: 'location' },
          ],
          systemLocations: [],
        }),
      })
    })

    await page.route('**/api/search-profiles/auto-match', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          profileId: 'seek-malaysia-sales',
          confidence: 0.95,
          matchedKeywords: ['Sales Engineer', 'Sales Manager'],
        }),
      })
    })

    await page.route('**/api/search-profiles/seek-malaysia-sales', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          profile: {
            id: 'seek-malaysia-sales',
            name: 'SEEK Malaysia Sales Engineer / Sales Manager',
            status: 'active',
            location: 'Kuala Lumpur MY',
            keywords: ['Sales Engineer', 'Sales Manager'],
            jobDescription: 'seek-malaysia-sales',
            filters: {
              minExperience: 2,
              maxAge: 45,
              locations: ['Kuala Lumpur MY'],
            },
            sources: [
              {
                type: 'seek',
                enabled: true,
                priority: 1,
                jobUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=90842915&pageNumber=1',
              },
            ],
          },
        }),
      })
    })

    await page.goto('/dev/resumes')

    await expect(page.getByRole('button', { name: 'Sales Engineer', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sales Manager', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Kuala Lumpur MY', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'SEEK · Sales Engineer / Sales Manager · Kuala Lumpur MY' }).click()

    await expect(page.getByRole('textbox', { name: '位置' })).toHaveValue('Kuala Lumpur MY')
    await expect(page.getByPlaceholder('自定义关键词...')).toHaveValue('Sales Engineer Sales Manager')
    await expect(page).toHaveURL(/location=Kuala(\+|%20)Lumpur(\+|%20)MY/)
    await expect(page).not.toHaveURL(/location=Kuala,Lumpur,MY/)
    await expect(page.getByText('SEEK Malaysia Sales Engineer / Sales Manager')).toBeVisible()

    await page.evaluate(() => {
      const openedUrls: string[] = []
      ;(window as Window & { __trOpenedUrls?: string[] }).__trOpenedUrls = openedUrls
      window.open = ((url?: string | URL) => {
        openedUrls.push(String(url))
        return null
      }) as typeof window.open
    })

    await page.getByRole('button', { name: '采集' }).click()

    await expect.poll(async () => {
      return await page.evaluate(() => (window as Window & { __trOpenedUrls?: string[] }).__trOpenedUrls?.[0] ?? null)
    }).toContain('https://my.employer.seek.com/candidates/recommended')

    const openedUrl = await page.evaluate(() => (window as Window & { __trOpenedUrls?: string[] }).__trOpenedUrls?.[0] ?? '')
    const collectUrl = new URL(openedUrl)
    expect(collectUrl.searchParams.get('jobId')).toBe('90842915')
    expect(collectUrl.searchParams.get('pageNumber')).toBe('1')
    expect(collectUrl.searchParams.get('tr_auto_sync')).toBe('true')
  })

  test('SEEK auto-match prefers the profile jobUrl for collect on raw query pages', async ({ page }) => {
    await mockResumePageApis(page, {
      searchResumes: [],
    })

    await page.route('**/api/search-profiles/auto-match', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          profileId: 'seek-malaysia-sales',
          confidence: 0.95,
          matchedKeywords: ['Sales Engineer', 'Sales Manager'],
        }),
      })
    })

    await page.route('**/api/search-profiles/seek-malaysia-sales', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          profile: {
            id: 'seek-malaysia-sales',
            name: 'SEEK Malaysia Sales Engineer / Sales Manager',
            status: 'active',
            location: 'Kuala Lumpur MY',
            keywords: ['Sales Engineer', 'Sales Manager'],
            jobDescription: 'seek-malaysia-sales',
            filters: {
              minExperience: 2,
              maxAge: 45,
              locations: ['Kuala Lumpur MY'],
            },
            sources: [
              {
                type: 'seek',
                enabled: true,
                priority: 1,
                jobUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=90842915&pageNumber=1',
              },
            ],
          },
        }),
      })
    })

    await page.goto('/dev/resumes?location=Kuala+Lumpur+MY&keyword=Sales+Engineer+Manager')
    await expect(page.getByText('SEEK Malaysia Sales Engineer / Sales Manager')).toBeVisible()
    await expect(page.getByRole('textbox', { name: '位置' })).toHaveValue('Kuala Lumpur MY')
    await expect(page.getByPlaceholder('自定义关键词...')).toHaveValue('Sales Engineer Manager')

    await page.evaluate(() => {
      const openedUrls: string[] = []
      ;(window as Window & { __trOpenedUrls?: string[] }).__trOpenedUrls = openedUrls
      window.open = ((url?: string | URL) => {
        openedUrls.push(String(url))
        return null
      }) as typeof window.open
    })

    await page.getByRole('button', { name: '采集' }).click()

    await expect.poll(async () => {
      return await page.evaluate(() => (window as Window & { __trOpenedUrls?: string[] }).__trOpenedUrls?.[0] ?? null)
    }).toContain('https://my.employer.seek.com/candidates/recommended')

    const openedUrl = await page.evaluate(() => (window as Window & { __trOpenedUrls?: string[] }).__trOpenedUrls?.[0] ?? '')
    const collectUrl = new URL(openedUrl as string)
    expect(collectUrl.searchParams.get('jobId')).toBe('90842915')
    expect(collectUrl.searchParams.get('pageNumber')).toBe('1')
    expect(collectUrl.searchParams.get('tr_auto_sync')).toBe('true')
    expect(collectUrl.searchParams.get('keyword')).toBeNull()

    await page.getByRole('link', { name: '趋势 Trends' }).click()

    await expect(page).toHaveURL(/\/dev\/resumes$/)
    await expect(page.getByRole('textbox', { name: '位置' })).toHaveValue('')
    await expect(page.getByPlaceholder('自定义关键词...')).toHaveValue('')
  })
})
