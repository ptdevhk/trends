import { describe, expect, it } from 'vitest'

import workArrayFixture from './src/lib/__tests__/__fixtures__/job51-detail-work-array.json'
import workExperienceListFixture from './src/lib/__tests__/__fixtures__/job51-detail-work-experience-list.json'
import {
  filterResumesByAgeRange,
} from './src/lib/job51-age-filter'
import {
  buildJob51DetailResumeFromPayload,
} from './src/lib/job51-detail-parser'

describe('job51 detail parser', () => {
  it('keeps 51job extraction-time age filtering active for URL-supplied ranges', () => {
    expect(
      filterResumesByAgeRange(
        [
          { name: 'A', age: '29岁' },
          { name: 'B', age: '32岁' },
          { name: 'C', age: '36岁' },
          { name: 'D', age: 'unknown' },
        ],
        '?tr_min_age=30&tr_max_age=35',
      ),
    ).toEqual([{ name: 'B', age: '32岁' }])
  })

  it('parses alternate 51job detail work-history arrays and preserves detailed descriptions', () => {
    const [resume] = buildJob51DetailResumeFromPayload(workExperienceListFixture, {
      profileUrl: 'https://ehire.51job.com/Revision/talent/resume/detail?contentType=&resumeId=123456',
    })

    expect(resume).toMatchObject({
      resumeId: '123456',
      perUserId: 'u-789',
      name: '张先生',
      age: '32岁',
      experience: '9年',
      education: '本科',
      location: '东莞',
      jobIntention: '销售经理',
      expectedSalary: '20000元/月',
    })
    expect(resume.workHistory).toEqual([
      expect.objectContaining({
        companyName: '东莞市台工智能装备有限公司',
        jobTitle: '高级销售工程师',
        startDate: '2021-03',
        endDate: '至今',
      }),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
    ])
    expect(String(resume.workHistory?.[0]?.description || '')).toContain('开发华南客户')
    expect(String(resume.workHistory?.[0]?.description || '')).toContain('维护大客户关系')
    expect(String(resume.workHistory?.[0]?.description || '')).toContain('负责机床销售和渠道拓展')
  })

  it('does not treat recent_position as the total experience fallback on detail pages', () => {
    const [resume] = buildJob51DetailResumeFromPayload({
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

  it('parses the current live 51job detail payload shape with workyear and jobintention arrays', () => {
    const [resume] = buildJob51DetailResumeFromPayload(workArrayFixture)

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
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
    ])
    expect(String(resume.workHistory?.[0]?.description || '')).toContain('负责河南区域CNC销售工作')
  })

  it('drops location-like company placeholders while preserving detailed work descriptions', () => {
    const [resume] = buildJob51DetailResumeFromPayload(workArrayFixture)

    expect(resume).toMatchObject({
      name: '袁先生',
      experience: '9',
      jobIntention: '销售经理',
      education: '大专',
      location: '洛阳',
      activityStatus: '2026.02.03',
    })
    expect(resume.workHistory).toEqual([
      expect.objectContaining({
        companyName: '苏州德扬数控机械有限公司',
        jobTitle: '销售工程师',
      }),
      expect.objectContaining({
        companyName: undefined,
        jobTitle: '销售工程师',
        startDate: '2020-07',
        endDate: '2021-12',
      }),
      expect.objectContaining({
        companyName: '宁波丰申智能装备有限公司',
        jobTitle: '销售工程师',
      }),
      expect.any(Object),
      expect.any(Object),
    ])
    expect(String(resume.workHistory?.[1]?.description || '')).toContain('机床销售、机床知识')
    expect(String(resume.workHistory?.[1]?.raw || '')).not.toContain('· 宁波 ·')
  })
})
