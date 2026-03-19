import { describe, expect, it } from 'vitest'

import {
  backfillEvidenceText,
  backfillJob5156LocationHierarchy,
  backfillJob5156WorkHistoryEducation,
  backfillManual51jobStructuredContent,
} from '../migrations'

type BackfillEvidenceTextResult = {
  scannedResumes: number
  patched: number
  hasMore: boolean
  cursor: string | null
}

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

const backfillEvidenceTextHandler = (backfillEvidenceText as unknown as ConvexHandler<
  Record<string, never>,
  BackfillEvidenceTextResult
>)._handler

const backfillJob5156WorkHistoryEducationHandler = (backfillJob5156WorkHistoryEducation as unknown as ConvexHandler<
  Record<string, never>,
  { scannedResumes: number; updatedResumes: number; movedEducationEntries: number; hasMore: boolean; cursor: string | null }
>)._handler

const backfillJob5156LocationHierarchyHandler = (backfillJob5156LocationHierarchy as unknown as ConvexHandler<
  Record<string, never>,
  {
    scannedResumes: number
    updatedResumes: number
    updatedLocationHierarchy: number
    updatedLocation: number
    updatedSearchText: number
    hasMore: boolean
    cursor: string | null
  }
>)._handler

const backfillManual51jobStructuredContentHandler = (backfillManual51jobStructuredContent as unknown as ConvexHandler<
  Record<string, never>,
  {
    scannedResumes: number
    updatedResumes: number
    updatedEvidenceText: number
    updatedSearchText: number
    scheduledReingest: number
    batches: number
    hasMore: boolean
    cursor: string | null
  }
>)._handler

type ResumeRecord = {
  _id: string
  content: Record<string, unknown>
  ingestData?: {
    evidenceText?: string
    industryTags: string[]
    synonymHits: string[]
    ruleScores: Record<string, number>
    experienceLevel: string
    computedAt: number
    skillsVersion: number
  }
}

function createResumesDb(records: ResumeRecord[]) {
  const patches: Array<{ id: string; patch: Partial<ResumeRecord> }> = []
  const scheduled: Array<{ delayMs: number; fn: unknown; args: unknown }> = []

  return {
    patches,
    scheduled,
    db: {
      query(tableName: string) {
        expect(tableName).toBe('resumes')
        return {
          order(direction: 'asc' | 'desc') {
            expect(direction).toBe('desc')
            return {
              async paginate() {
                return {
                  page: records.map((record) => ({ ...record })),
                  isDone: true,
                  continueCursor: 'cursor:done',
                }
              },
            }
          },
        }
      },
      async patch(id: string, patch: Partial<ResumeRecord>) {
        patches.push({ id, patch })
        const record = records.find((entry) => entry._id === id)
        if (record) {
          Object.assign(record, patch)
        }
      },
    },
    scheduler: {
      async runAfter(delayMs: number, fn: unknown, args: unknown) {
        scheduled.push({ delayMs, fn, args })
      },
    },
  }
}

describe('backfillEvidenceText', () => {
  it('backfills missing evidenceText for already-ingested resumes only', async () => {
    const records: ResumeRecord[] = [
      {
        _id: 'legacy-ingested',
        content: {
          workHistory: [
            { raw: ' 2020-2025 Sales Engineer ' },
            { raw: ' CNC 机床 ' },
          ],
        },
        ingestData: {
          industryTags: ['machinery'],
          synonymHits: [],
          ruleScores: { jd1: 80 },
          experienceLevel: 'mid',
          computedAt: 1_700_000_000_000,
          skillsVersion: 1,
        },
      },
      {
        _id: 'already-backed-filled',
        content: {
          workHistory: [{ raw: 'Old text should stay untouched' }],
        },
        ingestData: {
          evidenceText: 'existing evidence',
          industryTags: ['sales'],
          synonymHits: [],
          ruleScores: { jd2: 75 },
          experienceLevel: 'senior',
          computedAt: 1_700_000_000_100,
          skillsVersion: 2,
        },
      },
      {
        _id: 'not-yet-ingested',
        content: {
          workHistory: [{ raw: 'Should not be touched without ingestData' }],
        },
      },
    ]

    const ctx = createResumesDb(records)
    const result = await backfillEvidenceTextHandler(ctx as never, {})

    expect(result).toEqual({
      scannedResumes: 3,
      patched: 1,
      hasMore: false,
      cursor: null,
    })

    expect(ctx.patches).toContainEqual({
      id: 'legacy-ingested',
      patch: {
        ingestData: {
          industryTags: ['machinery'],
          synonymHits: [],
          ruleScores: { jd1: 80 },
          experienceLevel: 'mid',
          computedAt: 1_700_000_000_000,
          skillsVersion: 1,
          evidenceText: '2020-2025 sales engineer\ncnc 机床',
        },
      },
    })

    expect(ctx.patches.some((entry) => entry.id === 'already-backed-filled')).toBe(false)
    expect(ctx.patches.some((entry) => entry.id === 'not-yet-ingested')).toBe(false)
  })
})

describe('backfillJob5156WorkHistoryEducation', () => {
  it('moves Job5156 education-like work history into profileEducation and refreshes derived fields', async () => {
    const records: ResumeRecord[] = [
      {
        _id: 'job5156-legacy',
        content: {
          source: 'hr.job5156.com',
          profileUrl: 'https://hr.job5156.com/resume/view/123',
          workHistory: [
            { raw: '2015-01~2020-01 东莞精密机械有限公司 销售工程师' },
            { raw: '2010-09~2013-06 广西现代职业技术学院 数控技术 大专' },
          ],
        },
        ingestData: {
          evidenceText: 'stale evidence',
          industryTags: ['machinery'],
          synonymHits: [],
          ruleScores: { jd1: 80 },
          experienceLevel: 'mid',
          computedAt: 1_700_000_000_000,
          skillsVersion: 1,
        },
      },
      {
        _id: 'seek-legacy',
        content: {
          source: 'seek',
          profileUrl: 'https://seek.com/candidates/1',
          workHistory: [{ raw: '2010-09~2013-06 广西现代职业技术学院 数控技术 大专' }],
        },
        ingestData: {
          evidenceText: 'seek stale evidence',
          industryTags: ['machinery'],
          synonymHits: [],
          ruleScores: { jd1: 80 },
          experienceLevel: 'mid',
          computedAt: 1_700_000_000_000,
          skillsVersion: 1,
        },
      },
    ]

    const ctx = createResumesDb(records)
    const result = await backfillJob5156WorkHistoryEducationHandler(ctx as never, {})

    expect(result).toEqual({
      scannedResumes: 2,
      updatedResumes: 1,
      movedEducationEntries: 1,
      hasMore: false,
      cursor: null,
    })

    expect(ctx.patches).toContainEqual({
      id: 'job5156-legacy',
      patch: {
        content: {
          source: 'hr.job5156.com',
          profileUrl: 'https://hr.job5156.com/resume/view/123',
          workHistory: [
            { raw: '2015-01~2020-01 东莞精密机械有限公司 销售工程师' },
          ],
          profileEducation: [
            {
              institution: '2010-09~2013-06 广西现代职业技术学院 数控技术 大专',
              qualification: undefined,
              endDate: undefined,
            },
          ],
        },
        searchText: '2015-01~2020-01 东莞精密机械有限公司 销售工程师 2010-09~2013-06 广西现代职业技术学院 数控技术 大专 https://hr.job5156.com/resume/view/123 hr.job5156.com',
        ingestData: {
          evidenceText: '2015-01~2020-01 东莞精密机械有限公司 销售工程师',
          industryTags: ['machinery'],
          synonymHits: [],
          ruleScores: { jd1: 80 },
          experienceLevel: 'mid',
          computedAt: 1_700_000_000_000,
          skillsVersion: 1,
        },
      },
    })

    expect(ctx.patches.some((entry) => entry.id === 'seek-legacy')).toBe(false)
  })
})

describe('backfillJob5156LocationHierarchy', () => {
  it('backfills structured location hierarchy and rebuilds search text for Job5156 resumes', async () => {
    const records: ResumeRecord[] = [
      {
        _id: 'job5156-location',
        content: {
          source: 'hr.job5156.com',
          profileUrl: 'https://hr.job5156.com/resume/view/123',
          location: '',
          workHistory: [
            {
              raw: '2020-01~2024-01 东莞精密机械有限公司 销售工程师',
              companyName: '东莞精密机械有限公司',
              jobTitle: '销售工程师',
            },
          ],
        },
        ingestData: {
          evidenceText: 'stale evidence',
          industryTags: ['machinery'],
          synonymHits: ['销售'],
          ruleScores: { jd1: 80 },
          experienceLevel: 'mid',
          computedAt: 1_700_000_000_000,
          skillsVersion: 1,
        },
      },
    ]

    const ctx = createResumesDb(records)
    const result = await backfillJob5156LocationHierarchyHandler(ctx as never, {})

    expect(result).toEqual({
      scannedResumes: 1,
      updatedResumes: 1,
      updatedLocationHierarchy: 1,
      updatedLocation: 1,
      updatedSearchText: 1,
      hasMore: false,
      cursor: null,
    })

    expect(ctx.patches).toContainEqual({
      id: 'job5156-location',
      patch: expect.objectContaining({
        content: expect.objectContaining({
          source: 'hr.job5156.com',
          profileUrl: 'https://hr.job5156.com/resume/view/123',
          location: '广东东莞',
          locationHierarchy: {
            country: '中国',
            province: '广东',
            city: '东莞',
            matchedFrom: 'workHistory',
            confidence: 'high',
          },
        }),
        searchText: expect.stringContaining('中国'),
      }),
    })
  })
})

describe('backfillManual51jobStructuredContent', () => {
  it('repairs broken manual 51job records, rebuilds search text, refreshes evidence, and schedules reingest', async () => {
    const records: ResumeRecord[] = [
      {
        _id: 'manual-legacy',
        content: {
          profileType: '51job-manual',
          name: '张三',
          selfIntro: [
            '姓名：张三',
            '人才ID：123456',
            '现居·东莞',
            '应聘方向：销售工程师',
            '工作经历',
            '2021-03~至今 东莞精密机械有限公司 销售工程师',
            '工作描述：负责华南区机床销售与客户维护',
            '教育经历',
            '2015-09~2019-06 华南理工大学 机械设计制造及其自动化 本科',
            '个人优势',
            '熟悉CNC机床销售、客户跟进与方案沟通',
          ].join('\n'),
          resumeSnippet: {
            text: [
              '姓名：张三',
              '人才ID：123456',
              '现居·东莞',
              '应聘方向：销售工程师',
              '工作经历',
              '2021-03~至今 东莞精密机械有限公司 销售工程师',
              '工作描述：负责华南区机床销售与客户维护',
              '教育经历',
              '2015-09~2019-06 华南理工大学 机械设计制造及其自动化 本科',
              '个人优势',
              '熟悉CNC机床销售、客户跟进与方案沟通',
            ].join('\n'),
          },
          workHistory: [],
        },
        ingestData: {
          evidenceText: '',
          industryTags: ['machinery'],
          synonymHits: ['销售'],
          ruleScores: { jd1: 80 },
          experienceLevel: 'mid',
          computedAt: 1_700_000_000_000,
          skillsVersion: 1,
        },
      },
      {
        _id: 'manual-already-structured',
        content: {
          profileType: '51job-manual',
          name: '李四',
          resumeSnippet: { text: '姓名：李四' },
          workHistory: [
            {
              raw: '2020-01~至今 广州设备有限公司 销售工程师',
              companyName: '广州设备有限公司',
              jobTitle: '销售工程师',
              startDate: '2020-01',
              endDate: '至今',
            },
          ],
        },
        ingestData: {
          evidenceText: 'stale structured evidence',
          industryTags: ['machinery'],
          synonymHits: ['销售'],
          ruleScores: { jd1: 80 },
          experienceLevel: 'mid',
          computedAt: 1_700_000_000_100,
          skillsVersion: 1,
        },
      },
      {
        _id: 'manual-filename-fallback',
        content: {
          profileType: '51job-manual',
          name: '车床-谷仍友_销售工程师_广州',
          location: '广东广州',
          resumeSnippet: {
            text: [
              '应聘职位：车床销售工程师（东莞）',
              '应聘公司：宝力机械有限公司',
              '应聘时间：2025.06.03 - 活跃时间：2025.06.03',
              'ID：265281996',
              '',
              '仅供招聘专用，企业应尽保密义务，禁止外传',
              '',
              '谷仍友',
              '积极找工作（一个月内到岗）',
              '男 ｜ 42岁 ｜ 现居·广州-番禺区 ｜ 18年工作经验',
              '工作经历',
              '广州市振工机电设备有限公司',
              '2014.05 - 至今（11年1个月）',
              '职位：销售总监',
              '工作描述：主要销售日本津上数控车床，数控走心机，加工中心。',
            ].join('\n'),
          },
          workHistory: [
            {
              raw: '2014.05 - 至今（11年1个月）\n职位：销售总监\n工作描述：主要销售日本津上数控车床，数控走心机，加工中心。\n广州市振工机电设备有限公司',
              companyName: '在该公司',
              jobTitle: '聊',
            },
          ],
        },
        ingestData: {
          evidenceText: '',
          industryTags: ['machinery'],
          synonymHits: ['销售'],
          ruleScores: { jd3: 88 },
          experienceLevel: 'senior',
          computedAt: 1_700_000_000_300,
          skillsVersion: 1,
        },
      },
      {
        _id: 'manual-salary-and-location-refresh',
        content: {
          profileType: '51job-manual',
          name: '李湘',
          location: '',
          expectedSalary: '3000万',
          resumeSnippet: {
            text: [
              '应聘职位：车床/加工中心销售工程师（东莞）',
              '李湘',
              '积极找工作（一个月内到岗）',
              '女 ｜ 25岁 ｜ 东莞-虎门镇 ｜ 6年工作经验 ｜ 普通公民',
              '累计带领团队完成3000万销售额，超额达成既定目标。',
              '求职意向',
              '销售 ｜ 8000-11000/月 ｜ 东莞 ｜ 全职',
              '工作经历',
              '东莞汇振精密机械有限公司',
              '2021.04 - 2023.04（2年）',
              '职位：销售',
              '工作描述：在职期间，自主开发成交客户。',
            ].join('\n'),
          },
          workHistory: [
            {
              raw: '2021.04 - 2023.04（2年）',
              startDate: '2021-04',
              endDate: '2023-04',
            },
          ],
        },
        ingestData: {
          evidenceText: '',
          industryTags: ['machinery'],
          synonymHits: ['销售'],
          ruleScores: { jd4: 86 },
          experienceLevel: 'mid',
          computedAt: 1_700_000_000_350,
          skillsVersion: 1,
        },
      },
      {
        _id: 'seek-resume',
        content: {
          profileType: 'seek',
          name: 'Bob',
          selfIntro: 'legacy text',
          workHistory: [],
        },
        ingestData: {
          evidenceText: '',
          industryTags: ['sales'],
          synonymHits: [],
          ruleScores: { jd2: 70 },
          experienceLevel: 'mid',
          computedAt: 1_700_000_000_200,
          skillsVersion: 1,
        },
      },
    ]

    const ctx = createResumesDb(records)
    const result = await backfillManual51jobStructuredContentHandler(ctx as never, {})

    expect(result).toEqual({
      scannedResumes: 5,
      updatedResumes: 4,
      updatedEvidenceText: 4,
      updatedSearchText: 4,
      scheduledReingest: 3,
      batches: 1,
      hasMore: false,
      cursor: null,
    })

    expect(ctx.patches).toContainEqual({
      id: 'manual-legacy',
      patch: expect.objectContaining({
        content: expect.objectContaining({
          profileType: '51job-manual',
          location: '东莞',
          jobIntention: '销售工程师',
          education: '本科',
          selfIntro: '熟悉CNC机床销售、客户跟进与方案沟通',
          workHistory: [
            expect.objectContaining({
              companyName: '东莞精密机械有限公司',
              jobTitle: '销售工程师',
              description: '负责华南区机床销售与客户维护',
              startDate: '2021-03',
              endDate: '至今',
            }),
          ],
          profileEducation: [
            expect.objectContaining({
              institution: '华南理工大学',
              qualification: '本科',
              fieldOfStudy: '机械设计制造及其自动化',
              startDate: '2015-09',
              endDate: '2019-06',
            }),
          ],
        }),
        searchText: expect.stringContaining('东莞精密机械有限公司'),
        ingestData: expect.objectContaining({
          evidenceText: expect.stringContaining('东莞精密机械有限公司'),
        }),
      }),
    })

    expect(ctx.patches).toContainEqual({
      id: 'manual-filename-fallback',
      patch: expect.objectContaining({
        content: expect.objectContaining({
          name: '谷仍友',
          location: '广州-番禺区',
          jobIntention: '车床销售工程师（东莞）',
          workHistory: expect.arrayContaining([
            expect.objectContaining({
              companyName: '广州市振工机电设备有限公司',
              jobTitle: '销售总监',
              description: '主要销售日本津上数控车床 数控走心机 加工中心',
              startDate: '2014-05',
              endDate: '至今',
            }),
          ]),
        }),
        ingestData: expect.objectContaining({
          evidenceText: expect.stringContaining('广州市振工机电设备有限公司'),
        }),
      }),
    })

    expect(ctx.patches).toContainEqual({
      id: 'manual-already-structured',
      patch: expect.objectContaining({
        ingestData: expect.objectContaining({
          evidenceText: '2020-01 ~ 至今 广州设备有限公司 销售工程师',
        }),
        searchText: expect.stringContaining('广州设备有限公司'),
      }),
    })

    expect(ctx.patches).toContainEqual({
      id: 'manual-salary-and-location-refresh',
      patch: expect.objectContaining({
        content: expect.objectContaining({
          name: '李湘',
          location: '东莞-虎门镇',
          expectedSalary: '8000-11000/月',
          jobIntention: '销售 ｜ 8000-11000/月 ｜ 东莞 ｜ 全职',
        }),
        ingestData: expect.objectContaining({
          evidenceText: expect.stringContaining('东莞汇振精密机械有限公司'),
        }),
        searchText: expect.stringContaining('东莞-虎门镇'),
      }),
    })
    expect(ctx.patches.some((entry) => entry.id === 'seek-resume')).toBe(false)
    expect(ctx.scheduled).toHaveLength(1)
    expect(ctx.scheduled[0]).toMatchObject({
      delayMs: 0,
      args: { resumeIds: ['manual-legacy', 'manual-filename-fallback', 'manual-salary-and-location-refresh'] },
    })
  })
})
