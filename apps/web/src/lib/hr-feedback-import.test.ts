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
})
