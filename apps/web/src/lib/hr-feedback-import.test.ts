import { describe, expect, it } from 'vitest'

import { parseHrFeedbackRows } from './hr-feedback-import'

describe('parseHrFeedbackRows', () => {
  it('parses tab-separated rows without a header', () => {
    const rows = parseHrFeedbackRows('r1\tAlice\t半导体，行业不匹配\nr2\tBob\t宝力离职销售')

    expect(rows).toEqual([
      { resumeId: 'r1', name: 'Alice', comments: '半导体，行业不匹配', rowNumber: 1 },
      { resumeId: 'r2', name: 'Bob', comments: '宝力离职销售', rowNumber: 2 },
    ])
  })

  it('parses comma-separated rows with a header and quoted comments', () => {
    const rows = parseHrFeedbackRows('resumeId,name,comments\nr1,Alice,"半导体, industry mismatch"')

    expect(rows).toEqual([
      { resumeId: 'r1', name: 'Alice', comments: '半导体, industry mismatch', rowNumber: 2 },
    ])
  })

  it('parses Trends export CSV and falls back Job Intention when User Comment is empty', () => {
    const csv = [
      'Resume ID,Name,Job Intention,Profile URL,User Rating,User Comment',
      'k172ydnrexaqrhq66myhqqd1r18885k3,舒先生,半导体，行业不匹配,https://ehire.51job.com/Revision/talent/resume/detail?contentType=&resumeId=250533275,,',
      'k17475zbw6pmv5yw6crwr7dd1s899scn,谢先生,宝力离职销售,https://ehire.51job.com/Revision/talent/resume/detail?contentType=&resumeId=979890519,,explicit note',
    ].join('\n')

    const rows = parseHrFeedbackRows(csv)

    expect(rows).toEqual([
      {
        resumeId: 'k172ydnrexaqrhq66myhqqd1r18885k3',
        name: '舒先生',
        comments: '半导体，行业不匹配',
        profileUrl: 'https://ehire.51job.com/Revision/talent/resume/detail?contentType=&resumeId=250533275',
        rowNumber: 2,
      },
      {
        resumeId: 'k17475zbw6pmv5yw6crwr7dd1s899scn',
        name: '谢先生',
        comments: 'explicit note',
        profileUrl: 'https://ehire.51job.com/Revision/talent/resume/detail?contentType=&resumeId=979890519',
        rowNumber: 3,
      },
    ])
  })
})
