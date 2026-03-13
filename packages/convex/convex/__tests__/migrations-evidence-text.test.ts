import { describe, expect, it } from 'vitest'

import { backfillEvidenceText, backfillJob5156WorkHistoryEducation } from '../migrations'

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

  return {
    patches,
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
