import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import mixedWithProjectsFixture from '../../../__fixtures__/job51-detail-mixed-with-projects.json'
import workArrayFixture from '../../../__fixtures__/job51-detail-work-array.json'
import workExperienceListFixture from '../../../__fixtures__/job51-detail-work-experience-list.json'
import { filterResumesByAgeRange } from '../job51-age-filter'
import { buildJob51DetailResumeFromPayload } from '../job51-detail-parser'

function sanitizeResumesForSnapshot(resumes) {
  return resumes.map((resume) => {
    const sanitizedResume = { ...resume }
    delete sanitizedResume.rawData
    return sanitizedResume
  })
}

describe('job51-detail integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('captures legacy workExperienceList payloads as stable snapshots', () => {
    const resumes = buildJob51DetailResumeFromPayload(workExperienceListFixture, {
      profileUrl: 'https://ehire.51job.com/Revision/talent/resume/detail?contentType=&resumeId=123456',
    })

    expect(sanitizeResumesForSnapshot(resumes)).toMatchSnapshot()
  })

  it('filters legacy payloads by age ranges after parsing', () => {
    const resumes = filterResumesByAgeRange(
      buildJob51DetailResumeFromPayload(workExperienceListFixture, {
        profileUrl: 'https://ehire.51job.com/Revision/talent/resume/detail?contentType=&resumeId=123456',
      }),
      '?tr_min_age=30&tr_max_age=35',
    )

    expect(sanitizeResumesForSnapshot(resumes)).toMatchSnapshot()
  })

  it('captures live work-array payloads with placeholder company cleanup', () => {
    const resumes = filterResumesByAgeRange(
      buildJob51DetailResumeFromPayload(workArrayFixture),
      '?tr_min_age=35&tr_max_age=40',
    )

    expect(sanitizeResumesForSnapshot(resumes)).toMatchSnapshot()
  })

  it('captures mixed work-plus-project payloads with layered profile data', () => {
    const resumes = buildJob51DetailResumeFromPayload(mixedWithProjectsFixture)

    expect(sanitizeResumesForSnapshot(resumes)).toMatchSnapshot()
  })

  it('gracefully returns empty snapshots for minimal payloads', () => {
    expect(
      sanitizeResumesForSnapshot(buildJob51DetailResumeFromPayload({ data: { foo: 'bar' } })),
    ).toMatchSnapshot()
  })
})
