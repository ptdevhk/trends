import { describe, expect, it } from 'vitest'

import mixedWithProjectsFixture from './__fixtures__/job51-detail-mixed-with-projects.json'
import workArrayFixture from './__fixtures__/job51-detail-work-array.json'
import workExperienceListFixture from './__fixtures__/job51-detail-work-experience-list.json'
import { filterResumesByAgeRange } from '../job51-age-filter'
import { buildJob51DetailResumeFromPayload } from '../job51-detail-parser'

function sanitizeResumesForSnapshot(resumes) {
  return resumes.map((resume) => {
    const sanitizedResume = { ...resume }
    delete sanitizedResume.rawData
    delete sanitizedResume.extractedAt
    return sanitizedResume
  })
}

describe('job51-detail integration', () => {
  it('captures legacy workExperienceList payloads as stable snapshots', () => {
    const resumes = buildJob51DetailResumeFromPayload(workExperienceListFixture, {
      profileUrl: 'https://ehire.51job.com/Revision/talent/resume/detail?contentType=&resumeId=123456',
    })

    expect(sanitizeResumesForSnapshot(resumes)).toMatchSnapshot()
  })

  it('filters legacy payloads by age ranges after parsing', () => {
    const parsedResumes = buildJob51DetailResumeFromPayload(workExperienceListFixture, {
      profileUrl: 'https://ehire.51job.com/Revision/talent/resume/detail?contentType=&resumeId=123456',
    })
    const resumes = filterResumesByAgeRange(parsedResumes, '?tr_min_age=30&tr_max_age=35')

    expect(parsedResumes).toHaveLength(1)
    expect(parsedResumes[0]?.age).toBe('32岁')
    expect(resumes).toHaveLength(1)
    expect(resumes[0]?.age).toBe('32岁')
    expect(sanitizeResumesForSnapshot(resumes)).toMatchSnapshot()
  })

  it('excludes parsed legacy payloads when the age falls outside the requested range', () => {
    const resumes = filterResumesByAgeRange(
      buildJob51DetailResumeFromPayload(workExperienceListFixture, {
        profileUrl: 'https://ehire.51job.com/Revision/talent/resume/detail?contentType=&resumeId=123456',
      }),
      '?tr_min_age=33&tr_max_age=40',
    )

    expect(resumes).toEqual([])
  })

  it('captures live work-array payloads with placeholder company cleanup', () => {
    const resumes = filterResumesByAgeRange(
      buildJob51DetailResumeFromPayload(workArrayFixture),
      '?tr_min_age=35&tr_max_age=40',
    )

    expect(resumes).toHaveLength(1)
    expect(resumes[0]?.age).toBe('37岁')
    expect(sanitizeResumesForSnapshot(resumes)).toMatchSnapshot()
  })

  it('excludes parsed live work-array payloads when the age falls outside the requested range', () => {
    const resumes = filterResumesByAgeRange(
      buildJob51DetailResumeFromPayload(workArrayFixture),
      '?tr_min_age=25&tr_max_age=36',
    )

    expect(resumes).toEqual([])
  })

  it('captures mixed work-plus-project payloads with layered profile data', () => {
    const resumes = buildJob51DetailResumeFromPayload(mixedWithProjectsFixture)

    expect(sanitizeResumesForSnapshot(resumes)).toMatchSnapshot()
  })

  it('excludes unparseable ages when filtering is enabled after detail parsing', () => {
    const resumes = filterResumesByAgeRange(
      buildJob51DetailResumeFromPayload({
        data: {
          base_info: {
            userid: '999',
            resume_name: '测试候选人',
            age: 'unknown',
          },
        },
      }),
      '?tr_min_age=25&tr_max_age=40',
    )

    expect(resumes).toEqual([])
  })

  it('gracefully returns empty snapshots for minimal payloads', () => {
    expect(
      sanitizeResumesForSnapshot(buildJob51DetailResumeFromPayload({ data: { foo: 'bar' } })),
    ).toMatchSnapshot()
  })
})
