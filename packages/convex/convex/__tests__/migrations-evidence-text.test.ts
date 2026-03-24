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
  searchText?: string
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
              '工作描述：',
              '主要销售日本津上数控车床，数控走心机，加工中心，外圆磨床，机床周边，刀柄，刀具，切削液销售。',
              '主要客户：',
              '广汽乘用车有限公司',
              '汤浅商事（上海）有限公司广州公司',
              '2007.08 - 2014.03（6年7个月）',
              '机械/设备/重工 ｜ 少于50人 ｜ 外资（非欧美）',
              '职位：销售总监',
              '工作描述：',
              '主要销售日系，加工中心，车床，磨床，如日本泷泽，日本高松，兄弟机，法那科，LGMAZAK。',
              '工作内容：1，新客户业务开发',
              '主要客户：',
              '肇庆本田金属有限公司，日立汽车系统部件（广州）有限公司',
              '珠海松下马达有限公司，电装（广州南沙）有限公司',
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
              '机械/设备/重工 ｜ 少于50人 ｜ 民营',
              '职位：销售',
              '工作描述：',
              '在职期间，自主开发成交客户，维护成交客户。对精密模具，医疗零配件，汽车零配件客户等行业知名客户都有跟进成交（深圳市金大智能有限公司，东莞市达旺精密模具有限公司等），对进出口设备（牧野，罗德斯，雅思达，马扎克）机型和性能有一定了解   （本人有车）',
              '东莞市新法拉数控设备有限公司',
              '2018.01 - 2021.03（3年2个月）',
              '机械/设备/重工 ｜ 50-150人 ｜ 民营',
              '职位：销售经理',
              '工作描述：',
              '主要销售加工中心和加工中心，主要面对佛山片区业务，跟进开发所有佛山客户的成交，设备维护。',
              '广东凌盛科技有限公司',
              '2017.01 - 2018.03（1年2个月）',
              '计算机服务(系统、数据服务、维修) ｜ 少于50人 ｜ 民营',
              '职位：销售代表',
              '工作描述：',
              '通过电话销售向客户介绍我司产品 提升客户排名 增加单品手淘流量',
              '项目经验',
              '手机淘宝推广',
              '2017.01 - 2018.03',
              '所属公司：',
              '广东凌盛科技有限公司',
              '项目描述：',
              '通过电话销售手淘流量 手淘排行',
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
        _id: 'manual-project-labels',
        content: {
          profileType: '51job-manual',
          name: '赖先生',
          resumeSnippet: {
            text: [
              '赖先生',
              '工作经历',
              '哈挺机床（上海）有限公司',
              '2021.09 - 至今（4年2个月）',
              '机械/设备/重工 ｜ 150-500人 ｜ 外资（欧美）',
              '职位：销售经理',
              '工作描述：',
              '主要负责哈挺机床在华南区域的销售工作，',
              '1.定期客户拜访，技术交流，订单获取，技术支持，订单跟进，货款收回，',
              '2.经销商的销售支持，机床选型、节拍计算、客户拜访、技术交流、产品打样和工艺方案！帮助经销商完成销售目标',
              '广州数控设备有限公司',
              '2019.07 - 至今（6年4个月）',
              '机械/设备/重工 ｜ 1000-5000人 ｜ 民营',
              '职位：IT技术支持',
              '工作描述：',
              '1、负责广东省（广州部、佛山部、东深部、江珠部）20多位销售经理及代理商的技术支持工作如下：对客户提供的图纸和产品，做技术分析，出加工工艺方案，机床选型，客户拜访、技术交流、产品打样、案例报告等',
              '2、负责机床事业部自动化交钥匙工程机床选型、出加工方案、编程加工、交付、培训（三条自动化产线项目、含一条军工产线项目）',
              '3、负责广东省（深圳展、中山展、珠海展、江门展、佛山展）各展会机床布展、现场加工样件、机床产品特点推广等',
              '广州惠挺和数控设备有限公司',
              '2017.03 - 2019.07（2年4个月）',
              '机械/设备/重工 ｜ 少于50人 ｜ 民营',
              '职位：售前技术支持经理/主管',
              '工作描述：',
              '主要负责美国哈挺机床在华南地区的售前及售后服务；',
              '1.负责（广东、广西、江西、湖南、湖北）8位销售经理及代理商的技术支持工作如下：机床选型、节拍计算、客户拜访、技术交流、产品打样和工艺方案！',
              '2.负责售后技术服务：对客户进行机床、系统操作、数控编程、机床维修保养培训，设备故障维修等',
              '3. 负责过3个以上客户交钥匙工程（包含两个汽车零配件行业自动化上下料项目）：从调试机床-产品加工-CPK验收-培训交付',
              '4.通过电话或现场支持，为客户解决设备、加工出现的问题，包括保内设备的故障维修，保外设备的故障维修等；',
              '卡尔蔡司（广州）太阳镜片有限公司',
              '2014.05 - 2017.03（2年10个月）',
              '机械/设备/重工 ｜ 50-150人 ｜ 外资（欧美）',
              '职位：高级技术员',
              '工作描述：',
              '负责厂内机床设备维修、保养、；',
              '1.空压机，空调，冷水机，注塑机，镀膜机，超声波清洗线，等设备维修保养；',
              '2.配合生产部门制造工装夹具（solidworks ,autocad）设计及加工（车 铣 磨 钳 焊）；',
              '3.编制年、季、月度设备预检计划、设备大中修计划、备件库存和供应计划；',
              '广州市腾马机电设备有限公司',
              '2009.10 - 2013.12（4年2个月）',
              '机械/设备/重工 ｜ 少于50人 ｜ 民营',
              '职位：CNC/数控编程',
              '工作描述：',
              '主要负责工厂机械零件加工生产；',
              '1.熟练使用普通车床数控车床加工及编程；',
              '2.熟练使用普通铣床和数控加工中心操作和编程；',
              '3.熟练使用cad  mastercam  solidworks等软件；',
              '4.有电工证、焊工证、高压电工证、有多年的机械加工工作经验，熟悉机械加工工艺和材料特性；',
              '项目经验',
              '柳州光裕新能源汽车空调有限公司',
              '2019.03 - 2019.06',
              '所属公司：',
              '广州惠挺和数控设备有限公司',
              '项目描述：',
              '新能源汽车空调缸体缸盖机器人自动化生产线交钥匙项目',
              '9台哈挺车床9台哈挺加工中心6台fanuc机器人2台桁架机器人配合自动化年产35万台压缩机调试',
            ].join('\n'),
          },
          workHistory: [
            {
              raw: '柳州光裕新能源汽车空调有限公司\n2019.03 - 2019.06\n所属公司：\n广州惠挺和数控设备有限公司\n项目描述：\n新能源汽车空调缸体缸盖机器人自动化生产线交钥匙项目\n9台哈挺车床9台哈挺加工中心6台fanuc机器人2台桁架机器人配合自动化年产35万台压缩机调试',
              companyName: '广州惠挺和数控设备有限公司',
              jobTitle: '柳州光裕新能源汽车空调有限公司',
              description: '新能源汽车空调缸体缸盖机器人自动化生产线交钥匙项目 9台哈挺车床9台哈挺加工中心6台fanuc机器人2台桁架机器人配合自动化年产35万台压缩机调试',
              startDate: '2019-03',
              endDate: '2019-06',
            },
          ],
        },
        ingestData: {
          evidenceText: '',
          industryTags: ['machinery'],
          synonymHits: ['销售'],
          ruleScores: { jd5: 87 },
          experienceLevel: 'senior',
          computedAt: 1_700_000_000_400,
          skillsVersion: 1,
        },
      },
      {
        _id: 'manual-customer-list',
        content: {
          profileType: '51job-manual',
          name: '谷仍友',
          resumeSnippet: {
            text: [
              '谷仍友',
              '工作经历',
              '2007.08 - 2014.03（6年7个月）',
              '职位：销售总监',
              '工作描述：',
              '主要销售日系，加工中心，车床，磨床，如日本泷泽，日本高松，兄弟机，法那科，LGMAZAK。',
              '工作内容：1，新客户业务开发',
              '主要客户：',
              '肇庆本田金属有限公司，日立汽车系统部件（广州）有限公司',
              '珠海松下马达有限公司，电装（广州南沙）有限公司',
            ].join('\n'),
          },
          workHistory: [
            {
              raw: '2007.08 - 2014.03（6年7个月）\n职位：销售总监\n主要客户：\n肇庆本田金属有限公司，日立汽车系统部件（广州）有限公司',
              companyName: '肇庆本田金属有限公司',
              jobTitle: '销售总监',
              startDate: '2007-08',
              endDate: '2014-03',
            },
          ],
        },
        ingestData: {
          evidenceText: '',
          industryTags: ['machinery'],
          synonymHits: ['销售'],
          ruleScores: { jd6: 84 },
          experienceLevel: 'senior',
          computedAt: 1_700_000_000_450,
          skillsVersion: 1,
        },
      },
      {
        _id: 'manual-big-customer-list',
        content: {
          profileType: '51job-manual',
          name: '李先生',
          location: '深圳市宝乐宸科技有限公司',
          resumeSnippet: {
            text: [
              '李先生',
              '工作经历',
              '深圳市宝乐宸科技有限公司',
              '2022.05 - 2025.02（2年9个月）',
              '机械/设备/重工',
              '职位：销售经理',
              '工作描述：',
              '负责公司主要业务产品（数控机床）工业自动化装备配件（英威腾产品，尼得科 东佑达 雷塞，研华工控机 上银导轨 气动产品）销售',
              '深圳市金承诺实业有限公司',
              '2021.07 - 2022.03（8个月）',
              '机械/设备/重工 ｜ 50-150人 ｜ 民营',
              '职位：销售专员',
              '工作描述：',
              '1、负责广东区域（深圳西部、东莞机床，刀具，油品销售业务，包含西门子软件、UG销售工作，与客户保持良好沟通，实时把握客户需求。',
              '2、根据公司产品、价格及市场策略，独立处理询盘、报价、合同条款的协商及合同签订等事宜。',
              '3.、收集一线营销信息和用户意见，对公司营销策略售后服务等提出参考意见。参与产品营销计划的制定、实施、达成。',
              '4.、负责与客户的谈判、合同签订、供货、回款等工作。',
              '5、完成领导交办的临时任务。',
              '在金承诺工作期间，成功开发出5家客户。其中大客户：顺景园、嘉业精密、麦士德福、深圳利和兴等。',
              '深圳市兴丰元机电有限公司',
              '2017.01 - 2020.12（3年11个月）',
              '仪器仪表/工业自动化 ｜ 500-1000人 ｜ 已上市',
              '职位：销售专员',
              '工作描述：',
              '在兴丰元工作期间，成功开发出19家新客户，',
              '1、负责公司步进电机、伺服电机等相关客户开发。',
              '2、推动主要的产品导入，并最终成交。',
              '3、根据客户提出的要求，反馈给公司相关同事，并做出相应要求产品从而进行销售。',
              '4、根据客户选型的产品，提供样品，并进行试机，最终达成合作等',
              '深圳市领威科技有限公司',
              '2010.11 - 2016.12（6年1个月）',
              '机械/设备/重工 ｜ 50-150人',
              '职位：cnc/数控操机',
              '工作描述：',
              '负责公司铣床，磨床零部件加工，对于数控CNC加工有良好的加工心得',
            ].join('\n'),
          },
          workHistory: [
            {
              raw: '深圳市宝乐宸科技有限公司\n2022.05 - 2025.02（2年9个月）\n机械/设备/重工\n职位：销售经理\n工作描述：\n负责公司主要业务产品（数控机床）工业自动化装备配件（英威腾产品，尼得科 东佑达 雷塞，研华工控机 上银导轨 气动产品）销售\n深圳市金承诺实业有限公司',
              companyName: '深圳市宝乐宸科技有限公司',
              jobTitle: '销售经理',
              description: '机械/设备/重工 负责公司主要业务产品 数控机床 工业自动化装备配件 英威腾产品 尼得科 东佑达 雷塞 研华工控机 上银导轨 气动产品 销售 深圳市金承诺实业有限公司',
              startDate: '2022-05',
              endDate: '2025-02',
            },
            {
              raw: '2021.07 - 2022.03（8个月）\n机械/设备/重工 ｜ 50-150人 ｜ 民营\n职位：销售专员\n工作描述：\n1、负责广东区域（深圳西部、东莞机床，刀具，油品销售业务，包含西门子软件、UG销售工作，与客户保持良好沟通，实时把握客户需求。\n2、根据公司产品、价格及市场策略，独立处理询盘、报价、合同条款的协商及合同签订等事宜。\n3.、收集一线营销信息和用户意见，对公司营销策略售后服务等提出参考意见。参与产品营销计划的制定、实施、达成。\n4.、负责与客户的谈判、合同签订、供货、回款等工作。\n5、完成领导交办的临时任务。\n在金承诺工作期间，成功开发出5家客户。其中大客户：顺景园、嘉业精密、麦士德福、深圳利和兴等。\n深圳市兴丰元机电有限公司',
              companyName: '深圳市兴丰元机电有限公司',
              jobTitle: '销售专员',
              description: '机械/设备/重工 50-150人 民营 1、负责广东区域 深圳西部、东莞机床 刀具 油品销售业务 包含西门子软件、UG销售工作 与客户保持良好沟通 实时把握客户需求 2、根据公司产品、价格及市场策略 独立处理询盘、报价、合同条款的协商及合同签订等事宜 3.、收集一线营销信息和用户意见 对公司营销策略售后服务等提出参考意见 参与产品营销计划的制定、实施、达成 4.、负责与客户的谈判、合同签订、供货、回款等工作 5、完成领导交办的临时任务 在金承诺工作期间 成功开发出5家客户 其中大客户 顺景园、嘉业精密、麦士德福、深圳利和兴等',
              startDate: '2021-07',
              endDate: '2022-03',
            },
          ],
        },
        ingestData: {
          evidenceText: '',
          industryTags: ['machinery'],
          synonymHits: ['销售'],
          ruleScores: { jd7: 82 },
          experienceLevel: 'senior',
          computedAt: 1_700_000_000_475,
          skillsVersion: 1,
        },
      },
      {
        _id: 'manual-cross-page-noise',
        content: {
          profileType: '51job-manual',
          name: '李先生',
          resumeSnippet: {
            text: [
              '/',
              '李先生 在职（到岗时间待定）',
              '35岁\t18年经验\t大专\t现居·东莞-南城区',
              '岗位经验\tCNC/数控编程-3年7个月\t生产主管-4年5个月\t生产经理/车间主任-1年8个月\t生产领班/组长-2年11个月',
              'CNC/数控操机-2年1个月\t客户代表-9个月\t仓库管理员-3个月\t理货员-5个月',
              '先进电子（珠海）有限公司\tCNC高级工程师',
              '主要负责数控车床与车铣复合和\t产品优化，程序优化，调机优化与产品工艺优化等。',
              '德玛电子有限公司\tCNC主管',
              '人才ID:974495233\t活跃时间:2026.03.16',
              '求职意向',
              '工作经历',
              '2024.07-2025.01（6个月）',
              '走心机',
              '2021.01-2024.06（3年5个月）',
              '广州宝力机械科技有限公司东莞分公司',
              '广州宝力机械科技有限公司东莞分公司',
              '聊',
              '天',
              '-- 1 of 3 --',
              '/',
              '沃克森模具有限公司\t机加车间主任',
              '东莞永耀传动科技有限公司\tCNC主管',
              '东莞培锋精密机械有限公司\tCNC/数控编程',
              '东莞卓蓝自动化有限公司\t组长',
              '宁波市鄞州佳祺电子制造有限公司\t数控车床',
              '东莞万田油墨有限公司\t客户代表',
              '2019.05-2021.01（1年8个月）',
              '2018.05-2019.05（1年）',
              '2015.03-2018.04（3年1个月）',
              '2012.03-2015.02（2年11个月）',
              '2010.01-2012.02（2年1个月）',
              '2009.04-2010.01（9个月）',
              '聊',
              '天',
              '-- 2 of 3 --',
              '/',
              '南良集团\t仓库管理员',
              '惠州响水河超市\t营业员',
              '广东南方职业学院',
              '大专 · 机电一体化技术',
              '2024.03-2026.07',
              '湛江艺术学校',
              '中技/中专 · 声乐',
              '2006.08-2008.05',
              '2008.12-2009.03（3个月）',
              '2008.07-2008.12（5个月）',
              '教育经历',
            ].join('\n'),
          },
          workHistory: [
            {
              raw: '2024.07-2025.01（6个月）\n走心机\n2021.01-2024.06（3年5个月）\n广州宝力机械科技有限公司东莞分公司\n广州宝力机械科技有限公司东莞分公司\n聊\n天\n-- 1 of 3 --\n/\n沃克森模具有限公司\t机加车间主任',
              companyName: '沃克森模具有限公司',
              jobTitle: '走心机',
              description: '广州宝力机械科技有限公司东莞分公司 广州宝力机械科技有限公司东莞分公司',
              startDate: '2024-07',
              endDate: '2021-01',
            },
            {
              raw: '东莞万田油墨有限公司\t客户代表\n2009.04-2010.01（9个月）',
              companyName: '东莞万田油墨有限公司',
              jobTitle: '客户代表',
              startDate: '2009-04',
              endDate: '2010-01',
            },
            {
              raw: '南良集团\t仓库管理员\n广东南方职业学院\n2024.03-2026.07\n2008.12-2009.03（3个月）',
              companyName: '南良集团',
              jobTitle: '仓库管理员',
              description: '广东南方职业学院',
              startDate: '2024-03',
              endDate: '2009-03',
            },
          ],
        },
        ingestData: {
          evidenceText: '',
          industryTags: ['machinery'],
          synonymHits: ['CNC'],
          ruleScores: { jd8: 83 },
          experienceLevel: 'senior',
          computedAt: 1_700_000_000_490,
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
      scannedResumes: 9,
      updatedResumes: 8,
      updatedEvidenceText: 8,
      updatedSearchText: 8,
      scheduledReingest: 7,
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
              description: expect.stringContaining('主要销售日本津上数控车床'),
              startDate: '2014-05',
              endDate: '至今',
            }),
            expect.objectContaining({
              jobTitle: '销售总监',
              description: expect.stringContaining('主要客户 肇庆本田金属有限公司'),
              startDate: '2007-08',
              endDate: '2014-03',
            }),
          ]),
        }),
        ingestData: expect.objectContaining({
          evidenceText: expect.stringContaining('广州市振工机电设备有限公司'),
        }),
      }),
    })
    const filenameFallbackWorkHistory = ((ctx.patches.find((entry) => entry.id === 'manual-filename-fallback')?.patch.content as {
      workHistory?: Array<{ companyName?: string; description?: string }>
    } | undefined)?.workHistory)
    expect(filenameFallbackWorkHistory).toHaveLength(2)
    expect(filenameFallbackWorkHistory?.[1]?.description).toContain('珠海松下马达有限公司')
    expect(filenameFallbackWorkHistory?.[1]?.companyName).toBeUndefined()
    expect(filenameFallbackWorkHistory?.some((entry) => entry.companyName === '宝力机械有限公司')).toBe(false)
    expect(filenameFallbackWorkHistory?.some((entry) => entry.companyName === '肇庆本田金属有限公司')).toBe(false)
    expect(filenameFallbackWorkHistory?.some((entry) => entry.companyName === '汤浅商事（上海）有限公司广州公司')).toBe(false)

    expect(ctx.patches).toContainEqual({
      id: 'manual-already-structured',
      patch: expect.objectContaining({
        ingestData: expect.objectContaining({
          evidenceText: '2020-01 ~ 至今 广州设备有限公司 销售工程师',
        }),
        searchText: expect.stringContaining('广州设备有限公司'),
      }),
    })

    const salaryPatch = ctx.patches.find((entry) => entry.id === 'manual-salary-and-location-refresh')
    expect(salaryPatch).toBeDefined()
    const salaryContent = salaryPatch!.patch.content as Record<string, unknown>
    expect(salaryContent.name).toBe('李湘')
    expect(salaryContent.location).toBe('东莞-虎门镇')
    expect(salaryContent.expectedSalary).toBe('8000-11000/月')
    expect(salaryContent.jobIntention).toBe('销售 ｜ 8000-11000/月 ｜ 东莞 ｜ 全职')
    const salaryWorkHistory = salaryContent.workHistory as Array<{ companyName?: string; jobTitle?: string; startDate?: string; endDate?: string }>
    expect(salaryWorkHistory.length).toBeGreaterThanOrEqual(3)
    expect(salaryWorkHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ companyName: '东莞汇振精密机械有限公司', jobTitle: '销售', startDate: '2021-04', endDate: '2023-04' }),
      expect.objectContaining({ companyName: '东莞市新法拉数控设备有限公司', jobTitle: '销售经理', startDate: '2018-01', endDate: '2021-03' }),
      expect.objectContaining({ companyName: '广东凌盛科技有限公司', jobTitle: '销售代表', startDate: '2017-01', endDate: '2018-03' }),
    ]))
    expect(salaryPatch!.patch.ingestData).toEqual(expect.objectContaining({
      evidenceText: expect.stringContaining('东莞汇振精密机械有限公司'),
    }))
    expect(typeof salaryPatch!.patch.searchText).toBe('string')
    expect(salaryPatch!.patch.searchText as string).toContain('东莞')

    expect(ctx.patches.some((entry) => entry.id === 'seek-resume')).toBe(false)
    expect(ctx.scheduled).toHaveLength(1)
    expect(ctx.scheduled[0]).toMatchObject({
      delayMs: 0,
      args: { resumeIds: ['manual-legacy', 'manual-filename-fallback', 'manual-salary-and-location-refresh', 'manual-project-labels', 'manual-customer-list', 'manual-big-customer-list', 'manual-cross-page-noise'] },
    })

    expect(ctx.patches).toContainEqual({
      id: 'manual-project-labels',
      patch: expect.objectContaining({
        content: expect.objectContaining({
          name: '赖先生',
          workHistory: expect.arrayContaining([
            expect.objectContaining({
              companyName: '哈挺机床（上海）有限公司',
              jobTitle: '销售经理',
              startDate: '2021-09',
              endDate: '至今',
            }),
            expect.objectContaining({
              companyName: '广州数控设备有限公司',
              jobTitle: 'IT技术支持',
              startDate: '2019-07',
              endDate: '至今',
            }),
            expect.objectContaining({
              companyName: '广州惠挺和数控设备有限公司',
              jobTitle: '售前技术支持经理/主管',
              startDate: '2017-03',
              endDate: '2019-07',
            }),
            expect.objectContaining({
              companyName: '卡尔蔡司（广州）太阳镜片有限公司',
              jobTitle: '高级技术员',
              startDate: '2014-05',
              endDate: '2017-03',
            }),
            expect.objectContaining({
              companyName: '广州市腾马机电设备有限公司',
              jobTitle: 'CNC/数控编程',
              startDate: '2009-10',
              endDate: '2013-12',
            }),
            expect.objectContaining({
              companyName: '广州惠挺和数控设备有限公司',
              description: '新能源汽车空调缸体缸盖机器人自动化生产线交钥匙项目 9台哈挺车床9台哈挺加工中心6台fanuc机器人2台桁架机器人配合自动化年产35万台压缩机调试',
              startDate: '2019-03',
              endDate: '2019-06',
            }),
          ]),
        }),
        ingestData: expect.objectContaining({
          evidenceText: expect.stringContaining('广州惠挺和数控设备有限公司'),
        }),
        searchText: expect.stringContaining('广州惠挺和数控设备有限公司'),
      }),
    })
    const projectLabelsWorkHistory = (ctx.patches.find((entry) => entry.id === 'manual-project-labels')?.patch.content as {
      workHistory?: Array<{ jobTitle?: string; startDate?: string; endDate?: string }>
    } | undefined)?.workHistory
    expect(projectLabelsWorkHistory).toHaveLength(6)
    expect(projectLabelsWorkHistory?.find((entry) => entry.jobTitle === '柳州光裕新能源汽车空调有限公司')).toBeUndefined()
    expect(projectLabelsWorkHistory?.find((entry) => entry.startDate === '2019-03' && entry.endDate === '2019-06')?.jobTitle).toBeUndefined()
    expect(ctx.patches).toContainEqual({
      id: 'manual-customer-list',
      patch: expect.objectContaining({
        content: expect.objectContaining({
          workHistory: [
            expect.objectContaining({
              jobTitle: '销售总监',
              description: expect.stringContaining('主要客户 肇庆本田金属有限公司'),
              startDate: '2007-08',
              endDate: '2014-03',
            }),
          ],
        }),
        ingestData: expect.objectContaining({
          evidenceText: expect.stringContaining('主要客户 肇庆本田金属有限公司'),
        }),
      }),
    })
    expect(((ctx.patches.find((entry) => entry.id === 'manual-customer-list')?.patch.content as { workHistory?: Array<{ description?: string; companyName?: string }> } | undefined)?.workHistory?.[0]?.description)).toContain('珠海松下马达有限公司')
    expect(((ctx.patches.find((entry) => entry.id === 'manual-customer-list')?.patch.content as { workHistory?: Array<{ description?: string; companyName?: string }> } | undefined)?.workHistory?.[0]?.description)).toContain('电装 广州南沙 有限公司')
    expect(((ctx.patches.find((entry) => entry.id === 'manual-customer-list')?.patch.content as { workHistory?: Array<{ companyName?: string }> } | undefined)?.workHistory?.[0]?.companyName)).toBeUndefined()
    expect(((ctx.patches.find((entry) => entry.id === 'manual-customer-list')?.patch.content as { workHistory?: Array<{ companyName?: string }> } | undefined)?.workHistory?.[1]?.companyName)).toBeUndefined()
    expect(ctx.patches).toContainEqual({
      id: 'manual-big-customer-list',
      patch: expect.objectContaining({
        content: expect.objectContaining({
          workHistory: expect.arrayContaining([
            expect.objectContaining({
              companyName: '深圳市宝乐宸科技有限公司',
              jobTitle: '销售经理',
              startDate: '2022-05',
              endDate: '2025-02',
            }),
            expect.objectContaining({
              companyName: '深圳市金承诺实业有限公司',
              jobTitle: '销售专员',
              startDate: '2021-07',
              endDate: '2022-03',
            }),
            expect.objectContaining({
              companyName: '深圳市兴丰元机电有限公司',
              jobTitle: '销售专员',
              startDate: '2017-01',
              endDate: '2020-12',
            }),
            expect.objectContaining({
              companyName: '深圳市领威科技有限公司',
              jobTitle: 'cnc/数控操机',
              startDate: '2010-11',
              endDate: '2016-12',
            }),
          ]),
        }),
        ingestData: expect.objectContaining({
          evidenceText: expect.stringContaining('深圳市兴丰元机电有限公司'),
        }),
        searchText: expect.stringContaining('深圳市兴丰元机电有限公司'),
      }),
    })
    const bigCustomerListWorkHistory = ((ctx.patches.find((entry) => entry.id === 'manual-big-customer-list')?.patch.content as {
      workHistory?: Array<{ companyName?: string; description?: string }>
    } | undefined)?.workHistory)
    expect(bigCustomerListWorkHistory).toHaveLength(4)
    expect(bigCustomerListWorkHistory?.[0]?.description).not.toContain('深圳市金承诺实业有限公司')
    expect(bigCustomerListWorkHistory?.[1]?.description).not.toContain('深圳市兴丰元机电有限公司')
    expect(bigCustomerListWorkHistory?.[2]?.description).not.toContain('深圳市领威科技有限公司')
    const crossPagePatch = ctx.patches.find((entry) => entry.id === 'manual-cross-page-noise')
    expect(crossPagePatch).toBeDefined()
    const crossPageContent = crossPagePatch!.patch.content as { workHistory?: Array<{ companyName?: string; jobTitle?: string }> }
    expect(crossPageContent.workHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ companyName: '先进电子（珠海）有限公司', jobTitle: 'CNC高级工程师' }),
      expect.objectContaining({ companyName: '德玛电子有限公司', jobTitle: 'CNC主管' }),
      expect.objectContaining({ companyName: '沃克森模具有限公司', jobTitle: '机加车间主任' }),
      expect.objectContaining({ companyName: '东莞培锋精密机械有限公司', jobTitle: 'CNC/数控编程' }),
    ]))
    expect(crossPagePatch!.patch.ingestData).toEqual(expect.objectContaining({
      evidenceText: expect.stringContaining('先进电子（珠海）有限公司'),
    }))
    expect(typeof crossPagePatch!.patch.searchText).toBe('string')
    const crossPageNoiseWorkHistory = ((ctx.patches.find((entry) => entry.id === 'manual-cross-page-noise')?.patch.content as {
      workHistory?: Array<{ companyName?: string; jobTitle?: string }>
    } | undefined)?.workHistory)
    expect(crossPageNoiseWorkHistory).toHaveLength(10)
    expect(crossPageNoiseWorkHistory?.some((entry) => entry.companyName === '广州宝力机械科技有限公司东莞分公司')).toBe(false)
    expect(crossPageNoiseWorkHistory?.some((entry) => entry.jobTitle === '走心机')).toBe(false)
    expect(crossPageNoiseWorkHistory?.some((entry) => entry.companyName === '广东南方职业学院')).toBe(false)

    const patchCountAfterFirstRun = ctx.patches.length
    const scheduledCountAfterFirstRun = ctx.scheduled.length
    const secondResult = await backfillManual51jobStructuredContentHandler(ctx as never, {})

    expect(secondResult).toEqual({
      scannedResumes: 9,
      updatedResumes: 0,
      updatedEvidenceText: 0,
      updatedSearchText: 0,
      scheduledReingest: 0,
      batches: 0,
      hasMore: false,
      cursor: null,
    })
    expect(ctx.patches).toHaveLength(patchCountAfterFirstRun)
    expect(ctx.scheduled).toHaveLength(scheduledCountAfterFirstRun)
  })
})
