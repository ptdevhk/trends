import { describe, expect, it, vi } from 'vitest'

import mixedWithProjectsFixture from '../../../__fixtures__/job51-detail-mixed-with-projects.json'
import workArrayFixture from '../../../__fixtures__/job51-detail-work-array.json'
import workExperienceListFixture from '../../../__fixtures__/job51-detail-work-experience-list.json'
import {
  EHIRE_51JOB_HOST,
  EHIRE_51JOB_PROFILE_URL_PREFIX,
  buildJob51DetailResumeFromPayload,
  buildJob51EducationEntry,
  buildJob51ExperienceEntry,
  buildJob51LicenceEntry,
  buildJob51SkillEntry,
  getJob51DetailRoot,
  isLikelyJob51LocationPlaceholderCompanyName,
  normalizeJob51DateLike,
  normalizeJob51Text,
  readJob51MultilineText,
  readJob51Text,
} from '../job51-detail-parser'

describe('job51-detail-parser', () => {
  it('exports the expected 51job host constants', () => {
    expect(EHIRE_51JOB_HOST).toBe('ehire.51job.com')
    expect(EHIRE_51JOB_PROFILE_URL_PREFIX).toContain('resumeId=')
  })

  it('unwraps nested payload wrappers to the first usable detail root', () => {
    expect(
      getJob51DetailRoot({
        data: {
          result: {
            resume: {
              username: '张先生',
            },
          },
        },
      }),
    ).toEqual({ username: '张先生' })
  })

  it('unwraps arrays of candidate wrapper payloads', () => {
    expect(
      getJob51DetailRoot([
        null,
        { result: null },
        { result: { resume: { resumeId: 'R-1' } } },
      ]),
    ).toEqual({ resumeId: 'R-1' })
  })

  it('normalizes html-heavy 51job text values', () => {
    expect(normalizeJob51Text('<div> 销售　经理 </div>')).toBe('销售 经理')
  })

  it('reads the first non-empty normalized text value', () => {
    expect(readJob51Text('', '<span>销售经理</span>', 'ignored')).toBe('销售经理')
  })

  it('falls back to finite numeric text values', () => {
    expect(readJob51Text(null, 123456)).toBe('123456')
  })

  it('reads multiline text from nested arrays and objects', () => {
    expect(
      readJob51MultilineText([
        '',
        { description: '第一行' },
        { detail: '第二行' },
      ]),
    ).toBe('第一行\n第二行')
  })

  it('normalizes dotted and chinese date formats', () => {
    expect(normalizeJob51DateLike('2021.03')).toBe('2021-03')
    expect(normalizeJob51DateLike('2022年07月')).toBe('2022-07')
  })

  it('maps current-date labels to 至今', () => {
    expect(normalizeJob51DateLike('目前')).toBe('至今')
    expect(normalizeJob51DateLike('至今')).toBe('至今')
  })

  it('identifies likely location placeholder company names', () => {
    expect(isLikelyJob51LocationPlaceholderCompanyName('宁波')).toBe(true)
    expect(isLikelyJob51LocationPlaceholderCompanyName('广东省')).toBe(true)
  })

  it('rejects real company names as location placeholders', () => {
    expect(isLikelyJob51LocationPlaceholderCompanyName('宁波丰申智能装备有限公司')).toBe(false)
  })

  it('builds old-format work experience entries and deduplicates descriptions', () => {
    const entry = buildJob51ExperienceEntry({
      companyName: '东莞市台工智能装备有限公司',
      position: '高级销售工程师',
      startDate: '2021.03',
      endDate: '至今',
      responsibility_list: ['开发华南客户', '维护大客户关系'],
      workDetail: '负责机床销售和渠道拓展\n维护大客户关系',
    })

    expect(entry).toMatchObject({
      companyName: '东莞市台工智能装备有限公司',
      jobTitle: '高级销售工程师',
      startDate: '2021-03',
      endDate: '至今',
    })
    expect(String(entry?.description || '')).toContain('开发华南客户')
    expect(String(entry?.description || '')).toContain('负责机床销售和渠道拓展')
    expect(String(entry?.description || '').match(/维护大客户关系/g)?.length || 0).toBe(1)
  })

  it('builds current-format work entries and drops location-only company names', () => {
    const entry = buildJob51ExperienceEntry({
      compname: '宁波',
      position: '销售工程师',
      workdescribe: '机床销售与客户跟进',
      timefrom: '2022.10',
      timeto: '至今',
    })

    expect(entry).toMatchObject({
      companyName: undefined,
      jobTitle: '销售工程师',
      startDate: '2022-10',
      endDate: '至今',
    })
    expect(String(entry?.raw || '')).not.toContain('· 宁波 ·')
  })

  it('builds education entries with normalized dates', () => {
    expect(
      buildJob51EducationEntry({
        school_name: '江南大学',
        degree_value: '本科',
        major: '市场营销',
        start_date: '2008.09',
        end_date: '2012.06',
      }),
    ).toEqual({
      institution: '江南大学',
      qualification: '本科',
      fieldOfStudy: '市场营销',
      description: undefined,
      startDate: '2008-09',
      endDate: '2012-06',
    })
  })

  it('builds skill entries from strings and objects', () => {
    expect(buildJob51SkillEntry('Excel')).toBe('Excel')
    expect(buildJob51SkillEntry({ skill_name: 'CRM', level: '熟练' })).toEqual({
      name: 'CRM',
      level: '熟练',
    })
  })

  it('builds licence entries from strings and structured records', () => {
    expect(buildJob51LicenceEntry('PMP')).toEqual({ name: 'PMP' })
    expect(
      buildJob51LicenceEntry({
        certificate_name: '高级营销员',
        issuing_org: '东莞市职业技能鉴定中心',
        issued_date: '2019.06',
      }),
    ).toEqual({
      name: '高级营销员',
      authority: '东莞市职业技能鉴定中心',
      issuedAt: '2019-06',
    })
  })

  it('parses legacy workExperienceList fixtures into multi-entry resumes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'))

    const [resume] = buildJob51DetailResumeFromPayload(workExperienceListFixture, {
      profileUrl: 'https://ehire.51job.com/Revision/talent/resume/detail?contentType=&resumeId=123456',
    })

    expect(resume).toMatchObject({
      resumeId: '123456',
      perUserId: 'u-789',
      externalId: '123456',
      name: '张先生',
      age: '32岁',
      experience: '9年',
      education: '本科',
      location: '东莞',
      jobIntention: '销售经理',
      expectedSalary: '20000元/月',
      source: 'ehire.51job.com',
      profileUrl: 'https://ehire.51job.com/Revision/talent/resume/detail?contentType=&resumeId=123456',
      extractedAt: '2026-04-01T00:00:00.000Z',
    })
    expect(resume.workHistory).toHaveLength(4)
    expect(resume.profileEducation).toEqual([
      expect.objectContaining({
        institution: '广东工业大学',
        qualification: '本科',
      }),
    ])
    expect(resume.skills).toEqual([
      expect.objectContaining({ name: 'CRM', level: '熟练' }),
      'Excel',
      expect.objectContaining({ name: '招投标', level: '良好' }),
    ])
    expect(resume.licences).toHaveLength(2)

    vi.useRealTimers()
  })

  it('parses live work arrays with placeholder companies and normalized profile urls', () => {
    const [resume] = buildJob51DetailResumeFromPayload(workArrayFixture)

    expect(resume).toMatchObject({
      resumeId: '975386637',
      perUserId: '121430648',
      name: '袁先生',
      age: '37岁',
      experience: '9',
      education: '大专',
      location: '洛阳',
      jobIntention: '销售经理',
      expectedSalary: '8千-1.2万/月',
      activityStatus: '2026.02.03',
      profileUrl: `${EHIRE_51JOB_PROFILE_URL_PREFIX}975386637`,
    })
    expect(resume.workHistory).toHaveLength(5)
    expect(resume.workHistory[1]).toMatchObject({
      companyName: undefined,
      jobTitle: '销售工程师',
      startDate: '2020-07',
      endDate: '2021-12',
    })
    expect(String(resume.workHistory[3]?.description || '')).toContain('负责豫西工业品渠道招商')
  })

  it('parses mixed payloads with project, education, skill, and licence arrays', () => {
    const [resume] = buildJob51DetailResumeFromPayload(mixedWithProjectsFixture)

    expect(resume).toMatchObject({
      resumeId: 'R-778899',
      perUserId: 'A-556677',
      name: '李女士',
      age: '34岁',
      education: '本科',
      location: '苏州,上海',
      jobIntention: '大客户销售经理',
      expectedSalary: '25-30万/年',
      activityStatus: '3天前活跃',
    })
    expect(resume.workHistory).toHaveLength(2)
    expect(resume.projectExperience).toEqual([
      expect.objectContaining({
        companyName: '新能源电池模组自动化产线',
        jobTitle: '项目销售负责人',
        startDate: '2023-02',
        endDate: '2024-08',
      }),
      expect.objectContaining({
        companyName: 'Tier1零部件工厂数字化改造',
        jobTitle: '方案销售经理',
      }),
    ])
    expect(resume.profileEducation).toEqual([
      expect.objectContaining({ institution: '江南大学', qualification: '本科' }),
    ])
    expect(resume.skills).toEqual([
      expect.objectContaining({ name: 'Salesforce', level: '熟练' }),
      expect.objectContaining({ name: '项目管理', level: '熟练' }),
      'Power BI',
    ])
    expect(resume.licences).toHaveLength(2)
  })

  it('returns an empty array for minimal detail payloads', () => {
    expect(buildJob51DetailResumeFromPayload({ data: { foo: 'bar' } })).toEqual([])
  })
})
