import { expect, test, type Page } from '@playwright/test'
import { parseKeywordQuery } from '@trends/shared'
import type { Doc } from '../../../packages/convex/convex/_generated/dataModel'

type MockResume = Doc<'resumes'>

function parseConvexBody(route: Parameters<Page['route']>[1] extends (route: infer T) => unknown ? T : never) {
  return route.request().postDataJSON() as { path?: string; args?: Record<string, unknown> }
}

function isSeekMalaysiaRoleQuery(query: string): boolean {
  const parsed = parseKeywordQuery(query)
  return parsed.mode === 'OR'
    && parsed.keywords.length === 2
    && parsed.keywords[0] === 'Sales Engineer'
    && parsed.keywords[1] === 'Sales Manager'
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
    const requestUrl = new URL(route.request().url())
    const query = requestUrl.searchParams.get('q') ?? ''
    const summary = isSeekMalaysiaRoleQuery(query)
      ? {
          groups: [
            { original: 'sales engineer', variants: ['sales engineer'] },
            { original: 'sales manager', variants: ['sales manager'] },
          ],
          mode: 'OR',
          expandedTo: ['sales engineer', 'sales manager'],
          sourceMapping: {},
        }
      : {
          groups: [],
          mode: 'AND',
          expandedTo: [],
          sourceMapping: {},
        }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        summary,
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

  await page.route('**/api/search-profiles', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        profiles: [],
      }),
    })
  })

  await page.route('**/api/config/system-metadata', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        metadata: {
          identity: {
            appName: 'Trends',
            homeTitle: '简历筛选',
            systemTitle: 'System',
            settingsTitle: '设置',
            adminBadgeLabel: 'Admin',
            settingsBadgeLabel: 'Settings',
            appVersion: '0.2.0',
            apiVersion: '0.2.0',
            webVersion: '0.2.0',
          },
        },
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
          updatedAt: new Date().toISOString(),
        },
      }),
    })
  })

  await page.route('**/api/worker/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        jobs_executed: 0,
        jobs_failed: 0,
        jobs_missed: 0,
        last_run: null,
        last_success: null,
        last_failure: null,
        running: false,
        jobs: [],
      }),
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

const seekEngineerResume: MockResume = {
  _id: 'resume_seek_engineer',
  identityKey: 'resume_seek_engineer',
  externalId: 'seek:resume:engineer-1',
  source: 'my.employer.seek.com',
  tags: ['sales engineer'],
  crawledAt: 1710205323000,
  primaryRuleScore: 82,
  ingestData: {
    industryTags: ['sales'],
    synonymHits: [],
    brandHits: [],
    companyHits: [],
    roleSignals: [
      {
        type: 'engineer',
        matchedSignals: ['sales engineer'],
        signalCount: 1,
        occurrences: 1,
        years: 3,
        industryVerifiedYears: 3,
        roleRelevantYears: 3,
        industryVerifiedRelevantYears: 3,
        matchedWorkEntries: [
          {
            companyName: 'KL Automation',
            jobTitle: 'Sales Engineer',
            years: 3,
            industryVerified: true,
            matchedSignals: ['sales engineer'],
          },
        ],
        verifyIn: 'workHistory',
      },
    ],
    ruleScores: { industry: 78, role: 82 },
    experienceLevel: 'mid',
    computedAt: 1710205323000,
    skillsVersion: 2,
  },
  content: {
    name: 'Engineer Candidate',
    profileUrl: 'https://my.employer.seek.com/candidates/engineer-1',
    activityStatus: 'active',
    age: '31',
    experience: '7 years',
    education: 'Bachelor',
    location: 'Kuala Lumpur MY',
    selfIntro: 'Experienced in CNC solution selling and application engineering.',
    jobIntention: 'Sales Engineer',
    expectedSalary: 'RM 12,000',
    workHistory: [
      {
        raw: '2021-01~至今 KL Automation Sales Engineer',
        companyName: 'KL Automation',
        jobTitle: 'Sales Engineer',
        startDate: '2021-01',
        endDate: '至今',
      },
    ],
    extractedAt: '2026-03-12T01:02:03.000Z',
    resumeId: 'engineer-1',
    perUserId: 'seek-engineer-1',
  },
}

const seekManagerResume: MockResume = {
  _id: 'resume_seek_manager',
  identityKey: 'resume_seek_manager',
  externalId: 'seek:resume:manager-1',
  source: 'my.employer.seek.com',
  tags: ['sales manager'],
  crawledAt: 1710205323000,
  primaryRuleScore: 80,
  ingestData: {
    industryTags: ['sales'],
    synonymHits: [],
    brandHits: [],
    companyHits: [],
    roleSignals: [
      {
        type: 'manager',
        matchedSignals: ['sales manager'],
        signalCount: 1,
        occurrences: 1,
        years: 4,
        industryVerifiedYears: 4,
        roleRelevantYears: 4,
        industryVerifiedRelevantYears: 4,
        matchedWorkEntries: [
          {
            companyName: 'MY Industrial Systems',
            jobTitle: 'Sales Manager',
            years: 4,
            industryVerified: true,
            matchedSignals: ['sales manager'],
          },
        ],
        verifyIn: 'workHistory',
      },
    ],
    ruleScores: { industry: 76, role: 80 },
    experienceLevel: 'senior',
    computedAt: 1710205323000,
    skillsVersion: 2,
  },
  content: {
    name: 'Manager Candidate',
    profileUrl: 'https://my.employer.seek.com/candidates/manager-1',
    activityStatus: 'active',
    age: '36',
    experience: '10 years',
    education: 'Bachelor',
    location: 'Kuala Lumpur MY',
    selfIntro: 'Led regional industrial equipment teams across Malaysia.',
    jobIntention: 'Sales Manager',
    expectedSalary: 'RM 15,000',
    workHistory: [
      {
        raw: '2020-01~至今 MY Industrial Systems Sales Manager',
        companyName: 'MY Industrial Systems',
        jobTitle: 'Sales Manager',
        startDate: '2020-01',
        endDate: '至今',
      },
    ],
    extractedAt: '2026-03-12T01:02:03.000Z',
    resumeId: 'manager-1',
    perUserId: 'seek-manager-1',
  },
}

const seekGenericSalesResume: MockResume = {
  _id: 'resume_seek_generic',
  identityKey: 'resume_seek_generic',
  externalId: 'seek:resume:generic-1',
  source: 'my.employer.seek.com',
  tags: ['sales executive'],
  crawledAt: 1710205323000,
  primaryRuleScore: 40,
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
        years: 2,
        industryVerifiedYears: 1,
        roleRelevantYears: 2,
        industryVerifiedRelevantYears: 1,
        matchedWorkEntries: [
          {
            companyName: 'MY General Trading',
            jobTitle: 'Sales Executive',
            years: 2,
            industryVerified: false,
            matchedSignals: ['sales'],
          },
        ],
        verifyIn: 'workHistory',
      },
    ],
    ruleScores: { industry: 35, role: 40 },
    experienceLevel: 'mid',
    computedAt: 1710205323000,
    skillsVersion: 2,
  },
  content: {
    name: 'Generic Sales Candidate',
    profileUrl: 'https://my.employer.seek.com/candidates/generic-1',
    activityStatus: 'active',
    age: '30',
    experience: '6 years',
    education: 'Diploma',
    location: 'Kuala Lumpur MY',
    selfIntro: 'General B2B sales background.',
    jobIntention: 'Sales Executive',
    expectedSalary: 'RM 8,000',
    workHistory: [
      {
        raw: '2022-01~至今 MY General Trading Sales Executive',
        companyName: 'MY General Trading',
        jobTitle: 'Sales Executive',
        startDate: '2022-01',
        endDate: '至今',
      },
    ],
    extractedAt: '2026-03-12T01:02:03.000Z',
    resumeId: 'generic-1',
    perUserId: 'seek-generic-1',
  },
}

test.describe('Resume quick role filter', () => {
  test('home navigation clears search state while direct links and legacy redirects still hydrate', async ({ page }) => {
    await mockResumePageApis(page, {
      searchResumes: [engineerResume, salesResume],
    })

    await page.goto('/resumes?location=%E4%B8%9C%E8%8E%9E&q=CNC+%E8%BD%A6%E5%BA%8A+%E9%94%80%E5%94%AE+STAR')

    const keywordInput = page.getByTestId('resume-search-input')

    await expect(page).toHaveURL(/\/dev\/resumes\?location=.*q=/)
    await expect(keywordInput).toHaveValue('CNC 车床 销售 STAR')
    await expect.poll(async () => new URL(page.url()).searchParams.get('location')).toBe('东莞')
    await expect(page.getByText('2 条结果，查询“CNC 车床 销售 STAR”')).toBeVisible()

    await page.getByRole('link', { name: '趋势 Trends' }).click()

    await expect(page).toHaveURL(/\/dev\/resumes$/)
    await expect(keywordInput).toHaveValue('')
    await expect.poll(async () => new URL(page.url()).searchParams.get('location')).toBeNull()

    await page.goBack()

    await expect(page).toHaveURL(/\/dev\/resumes\?location=.*q=/)
    await expect(keywordInput).toHaveValue('CNC 车床 销售 STAR')
    await expect.poll(async () => new URL(page.url()).searchParams.get('location')).toBe('东莞')
  })

  test('engineer role filter keeps only engineer-tagged resumes when explicit role constraints are present', async ({ page }) => {
    await mockResumePageApis(page, {
      listResumes: [engineerResume, salesResume],
      jobDescriptionRoleType: 'engineer',
      jobDescriptionMinYears: 1,
    })

    await page.goto('/dev/resumes?location=%E5%B9%BF%E4%B8%9C&jd=senior-mechanical-engineer&minRoleYears=1&roleType=engineer')

    await expect(page.getByRole('button', { name: '查看' })).toHaveCount(1)
    await expect(page.getByText('李先生')).toBeVisible()
    await expect(page.getByText('王女士')).toHaveCount(0)

    const visibleSummary = page.getByText('销售工程师')
    await expect(visibleSummary.first()).toBeVisible()
  })

  test('enriched screening sample keeps evidence visible in card and detail views', async ({ page }) => {
    await mockResumePageApis(page, {
      searchResumes: [engineerResume, salesResume],
    })

    await page.goto('/dev/resumes?q=%E9%94%80%E5%94%AE%E5%B7%A5%E7%A8%8B%E5%B8%88')

    await expect(page.getByRole('button', { name: '查看' })).toHaveCount(2)
    await expect(page.getByText('李先生')).toBeVisible()
    await expect(page.getByText('王女士')).toBeVisible()
    await expect(page.getByText('machinery', { exact: true })).toBeVisible()
    await expect(page.getByText('haas', { exact: true })).toBeVisible()
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

    await page.goto('/dev/resumes?q=%E9%94%80%E5%94%AE%E5%B7%A5%E7%A8%8B%E5%B8%88&minRoleYears=1&roleType=engineer')

    await expect(page.getByRole('button', { name: '查看' })).toHaveCount(1)
    await expect(page.getByText('李先生')).toBeVisible()
    await expect(page.getByText('王女士')).toHaveCount(0)
  })

  test('SEEK Malaysia workflow preserves OR phrase intent end to end', async ({ page }) => {
    await mockResumePageApis(page, {
      searchResumes: [seekEngineerResume, seekManagerResume, seekGenericSalesResume],
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

    await page.goto('/dev/resumes?location=Kuala+Lumpur+MY&q=%22Sales+Engineer%22+OR+%22Sales+Manager%22')

    await expect(page.getByTestId('resume-search-input')).toHaveValue('"Sales Engineer" OR "Sales Manager"')
    await expect(page).toHaveURL(/location=Kuala(\+|%20)Lumpur(\+|%20)MY/)
    await expect(page).not.toHaveURL(/location=Kuala,Lumpur,MY/)
    await expect(page.getByText('Engineer Candidate')).toBeVisible()
    await expect(page.getByText('Manager Candidate')).toBeVisible()

    await expect(page.getByRole('button', { name: '查看' })).toHaveCount(2)
    await expect(page.getByText('Engineer Candidate')).toBeVisible()
    await expect(page.getByText('Manager Candidate')).toBeVisible()
    await expect(page.getByText('Generic Sales Candidate')).toHaveCount(0)
  })

  test('SEEK raw query keeps location context while avoiding false-positive matches', async ({ page }) => {
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

    await page.goto('/dev/resumes?location=Kuala+Lumpur+MY&q=Sales+Engineer+Manager')
    await expect(page.getByTestId('resume-search-input')).toHaveValue('Sales Engineer Manager')
    await expect.poll(async () => new URL(page.url()).searchParams.get('location')).toBe('Kuala Lumpur MY')
    await expect(page.getByRole('heading', { name: '没有匹配到简历' })).toBeVisible()
    await expect(page.getByRole('button', { name: '查看' })).toHaveCount(0)

    await page.getByRole('link', { name: '趋势 Trends' }).click()

    await expect(page).toHaveURL(/\/dev\/resumes$/)
    await expect(page.getByTestId('resume-search-input')).toHaveValue('')
  })
})
