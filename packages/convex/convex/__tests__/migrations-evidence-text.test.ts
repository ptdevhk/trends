import { describe, expect, it } from 'vitest'

import { backfillEvidenceText } from '../migrations'

type BackfillEvidenceTextResult = {
  scannedResumes: number
  patched: number
}

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

const backfillEvidenceTextHandler = (backfillEvidenceText as unknown as ConvexHandler<
  Record<string, never>,
  BackfillEvidenceTextResult
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
          async collect() {
            return records.map((record) => ({ ...record }))
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
