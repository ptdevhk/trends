import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const CONTENT_FILE_URL = new URL('./content.js', import.meta.url)
const FIXTURE_FILE_URL = new URL('./job51-detail-parser.fixture.json', import.meta.url)
const CONTENT_SOURCE_PROMISE = readFile(CONTENT_FILE_URL, 'utf8')
const FIXTURE_PROMISE = readFile(FIXTURE_FILE_URL, 'utf8').then((text) => JSON.parse(text) as Record<string, unknown>)

type Job51ParserHelpers = {
  filterResumesByAgeRange: (resumes: Array<Record<string, unknown>>) => Array<Record<string, unknown>>
  buildJob51DetailResumeFromPayload: (payload: Record<string, unknown>, options?: Record<string, unknown>) => Array<Record<string, unknown>>
}

function extractFunctionSource(source: string, name: string): string {
  const signature = `function ${name}(`
  const start = source.indexOf(signature)
  if (start < 0) {
    throw new Error(`Failed to find function ${name}`)
  }

  const paramsStart = source.indexOf('(', start)
  if (paramsStart < 0) {
    throw new Error(`Failed to find parameter list for ${name}`)
  }

  let paramsDepth = 1
  let paramsEnd = -1
  for (let index = paramsStart + 1; index < source.length; index += 1) {
    const char = source[index]
    if (char === '(') {
      paramsDepth += 1
      continue
    }
    if (char === ')') {
      paramsDepth -= 1
      if (paramsDepth === 0) {
        paramsEnd = index
        break
      }
    }
  }
  if (paramsEnd < 0) {
    throw new Error(`Failed to find end of parameter list for ${name}`)
  }

  const bodyStart = source.indexOf('{', paramsEnd)
  if (bodyStart < 0) {
    throw new Error(`Failed to find function body for ${name}`)
  }

  let depth = 1
  for (let index = bodyStart + 1; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') {
      depth += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return source.slice(start, index + 1)
      }
    }
  }

  throw new Error(`Failed to extract function source for ${name}`)
}

async function loadHelpers(search: string): Promise<Job51ParserHelpers> {
  const source = await CONTENT_SOURCE_PROMISE
  const functionNames = [
    'normalizeOptionalPositiveInt',
    'parseAgeNumber',
    'getAgeRangeFromUrl',
    'filterResumesByAgeRange',
    'normalizeResumeText',
    'normalizeResumeMultilineText',
    'stripHtmlTags',
    'normalizeJob51Text',
    'normalizeJob51MultilineText',
    'isLikelyJob51LocationPlaceholderCompanyName',
    'buildWorkHistoryRawParts',
    'getJob51DetailRoot',
    'readJob51Text',
    'readJob51MultilineText',
    'normalizeJob51DateLike',
    'readJob51Array',
    'buildJob51ExperienceEntry',
    'buildJob51EducationEntry',
    'buildJob51SkillEntry',
    'buildJob51LicenceEntry',
    'buildJob51DetailResumeFromPayload',
  ]
  const snippets = functionNames.map((name) => extractFunctionSource(source, name)).join('\n')

  const factory = new Function(
    'window',
    'AUTO_MIN_AGE_PARAM',
    'AUTO_MAX_AGE_PARAM',
    'EHIRE_51JOB_HOST',
    'EHIRE_51JOB_PROFILE_URL_PREFIX',
    `${snippets}
return {
  filterResumesByAgeRange,
  buildJob51DetailResumeFromPayload,
}`,
  ) as (
    window: { location: { search: string } },
    autoMinAgeParam: string,
    autoMaxAgeParam: string,
    sourceHost: string,
    profileUrlPrefix: string,
  ) => Job51ParserHelpers

  return factory(
    { location: { search } },
    'tr_min_age',
    'tr_max_age',
    'ehire.51job.com',
    'https://ehire.51job.com/Revision/talent/resume/detail?contentType=&resumeId=',
  )
}

describe('job51 detail parser', () => {
  it('keeps 51job extraction-time age filtering active for URL-supplied ranges', async () => {
    const helpers = await loadHelpers('?tr_min_age=30&tr_max_age=35')

    expect(helpers.filterResumesByAgeRange([
      { name: 'A', age: '29岁' },
      { name: 'B', age: '32岁' },
      { name: 'C', age: '36岁' },
      { name: 'D', age: 'unknown' },
    ])).toEqual([
      { name: 'B', age: '32岁' },
    ])
  })

  it('parses alternate 51job detail work-history arrays and preserves detailed descriptions', async () => {
    const helpers = await loadHelpers('')
    const fixture = await FIXTURE_PROMISE

    const [resume] = helpers.buildJob51DetailResumeFromPayload(fixture, {
      profileUrl: 'https://ehire.51job.com/Revision/talent/resume/detail?contentType=&resumeId=123456',
    })

    expect(resume).toMatchObject({
      resumeId: '123456',
      perUserId: 'u-789',
      name: '张三',
      age: '32岁',
      experience: '9年',
      education: '本科',
      location: '东莞',
      jobIntention: '销售经理',
      expectedSalary: '20000元/月',
    })
    expect(resume.workHistory).toEqual([
      expect.objectContaining({
        companyName: '东莞市某机械有限公司',
        jobTitle: '高级销售工程师',
        startDate: '2021-03',
        endDate: '至今',
      }),
    ])
    expect(String(resume.workHistory?.[0]?.description || '')).toContain('开发华南客户')
    expect(String(resume.workHistory?.[0]?.description || '')).toContain('维护大客户关系')
    expect(String(resume.workHistory?.[0]?.description || '')).toContain('负责机床销售和渠道拓展')
  })

  it('does not treat recent_position as the total experience fallback on detail pages', async () => {
    const helpers = await loadHelpers('')

    const [resume] = helpers.buildJob51DetailResumeFromPayload({
      data: {
        base_info: {
          userid: '9988',
          resume_name: '李四',
        },
        recent_work_info: {
          recent_position: '销售总监',
        },
        workExperienceList: [
          {
            companyName: '深圳某设备有限公司',
            position: '销售经理',
            startDate: '2020.01',
            endDate: '至今',
          },
        ],
      },
    })

    expect(resume?.experience).toBe('')
    expect(resume?.jobIntention).toBe('销售总监')
  })

  it('parses the current live 51job detail payload shape with workyear and jobintention arrays', async () => {
    const helpers = await loadHelpers('')

    const [resume] = helpers.buildJob51DetailResumeFromPayload({
      data: {
        resumeid: '975386637',
        accountid: '121430648',
        username: '袁先生',
        displayage: '37岁',
        workyear: '9',
        activetimelabel: '2026.02.03',
        jobintention: [
          {
            expectfuncname: '销售经理',
            newdisplayexpectsalary: '8千-1.2万/月',
            expectarea: [{ provincecity: '洛阳', county: '' }],
          },
        ],
        highestdegree: {
          degree: '大专',
        },
        work: [
          {
            compname: '苏州德扬数控机械有限公司',
            position: '销售工程师',
            workdescribe: '负责河南区域CNC销售工作，年销售任务达标。',
            worktime: '4年3个月',
            timefrom: '2022.01',
            timeto: '至今',
            workindustry: '机械/设备/重工',
            companysize: '150-500人',
            companytype: '民营',
          },
        ],
      },
    })

    expect(resume).toMatchObject({
      name: '袁先生',
      age: '37岁',
      experience: '9',
      education: '大专',
      location: '洛阳',
      jobIntention: '销售经理',
      expectedSalary: '8千-1.2万/月',
      activityStatus: '2026.02.03',
    })
    expect(resume.workHistory).toEqual([
      expect.objectContaining({
        companyName: '苏州德扬数控机械有限公司',
        jobTitle: '销售工程师',
        startDate: '2022-01',
        endDate: '至今',
      }),
    ])
    expect(String(resume.workHistory?.[0]?.description || '')).toContain('负责河南区域CNC销售工作')
  })

  it('drops location-like company placeholders while preserving detailed work descriptions', async () => {
    const helpers = await loadHelpers('')

    const [resume] = helpers.buildJob51DetailResumeFromPayload({
      data: {
        resumeid: '219816768',
        username: '王先生',
        displayage: '30岁',
        workyear: '10',
        activetimelabel: '1小时前活跃',
        jobintention: [
          {
            expectfuncname: '销售工程师',
            newdisplayexpectsalary: '8千-1.2万/月',
            expectarea: [{ provincecity: '宁波', county: '' }],
          },
        ],
        highestdegree: {
          degree: '中技/中专',
        },
        work: [
          {
            compname: '宁波',
            position: '销售工程师',
            workindustry: '汽车研发/制造',
            workdescribe: '机床销售、机床知识： 熟悉CNC数控机床、加工中心、车床、铣床、磨床等的工作原理及应用场景；了解发那科（FANUC）、西门子（SIEMENS）等主流数控系统。',
            worktime: '3年6个月',
            timefrom: '2022.10',
            timeto: '至今',
          },
          {
            compname: '宁波丰申智能装备有限公司',
            position: '销售工程师',
            workdescribe: '大客户销售、解决方案式销售、商务谈判、合同管理、市场分析。',
            worktime: '4年6个月',
            timefrom: '2021.10',
            timeto: '至今',
          },
        ],
      },
    })

    expect(resume).toMatchObject({
      name: '王先生',
      experience: '10',
      jobIntention: '销售工程师',
      education: '中技/中专',
      location: '宁波',
      activityStatus: '1小时前活跃',
    })
    expect(resume.workHistory).toEqual([
      expect.objectContaining({
        companyName: undefined,
        jobTitle: '销售工程师',
        startDate: '2022-10',
        endDate: '至今',
      }),
      expect.objectContaining({
        companyName: '宁波丰申智能装备有限公司',
        jobTitle: '销售工程师',
      }),
    ])
    expect(String(resume.workHistory?.[0]?.description || '')).toContain('机床销售、机床知识')
    expect(String(resume.workHistory?.[0]?.raw || '')).not.toContain('· 宁波 ·')
  })
})
