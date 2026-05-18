import { describe, expect, it, vi } from 'vitest'

import { deleteResumes } from '../resumes'

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

type DeleteResumesResult = {
  requested: number
  deleted: number
  missingResumeIds: string[]
  deletedAiTaggingResults: number
  patchedScreeningSessions: number
}

const deleteResumesHandler = (deleteResumes as unknown as ConvexHandler<
  { resumeIds: string[] },
  DeleteResumesResult
>)._handler

describe('deleteResumes', () => {
  it('deletes targeted resumes, cascades ai tagging rows, and patches reviewed session references', async () => {
    const resumes = new Map([
      ['resume-1', {
        _id: 'resume-1',
        externalId: 'ext-1',
        content: { name: 'Alice' },
        hash: 'hash-1',
        source: 'source-a',
        crawledAt: 1,
        tags: [],
      }],
      ['resume-2', {
        _id: 'resume-2',
        externalId: 'ext-2',
        content: { name: 'Bob' },
        hash: 'hash-2',
        source: 'source-b',
        crawledAt: 2,
        tags: [],
      }],
    ])
    const aiTaggingResults = [
      { _id: 'tag-1', resumeId: 'resume-1', profileKey: 'sales' },
      { _id: 'tag-2', resumeId: 'resume-1', profileKey: 'service' },
      { _id: 'tag-3', resumeId: 'resume-2', profileKey: 'sales' },
    ]
    const screeningSessions = [
      { _id: 'session-1', reviewedResumeIds: ['resume-1', 'keep-me'] },
      { _id: 'session-2', reviewedResumeIds: ['resume-2', 'resume-1'] },
      { _id: 'session-3', reviewedResumeIds: ['keep-me'] },
    ]

    const deletedIds: string[] = []
    const patch = vi.fn(async (id: string, value: { reviewedResumeIds: string[] }) => {
      const session = screeningSessions.find((entry) => entry._id === id)
      if (session) {
        session.reviewedResumeIds = value.reviewedResumeIds
      }
    })

    let cursorState: string | null = null

    const ctx = {
      db: {
        normalizeId(tableName: string, id: string) {
          expect(tableName).toBe('resumes')
          if (id === 'resume-1' || id === 'resume-2' || id === 'resume-missing') {
            return id
          }
          return null
        },
        async get(id: string) {
          return resumes.get(id) ?? null
        },
        query(tableName: string) {
          if (tableName === 'ai_tagging_results') {
            return {
              withIndex(indexName: string, apply: (q: { eq: (field: string, value: string) => { field: string; value: string } }) => { field: string; value: string }) {
                expect(indexName).toBe('by_resume_profile')
                const clause = apply({
                  eq(field: string, value: string) {
                    return { field, value }
                  },
                })
                expect(clause.field).toBe('resumeId')
                return {
                  async collect() {
                    return aiTaggingResults.filter((entry) => entry.resumeId === clause.value)
                  },
                }
              },
            }
          }

          if (tableName === 'screening_sessions') {
            return {
              async collect() {
                return screeningSessions.map((entry) => ({ ...entry }))
              },
              async paginate(opts: { cursor?: string | null }) {
                if (opts.cursor && opts.cursor === cursorState) {
                  return { page: [], continueCursor: null, isDone: true };
                }
                cursorState = 'cursor-next';
                return { page: screeningSessions.map((entry) => ({ ...entry })), continueCursor: 'cursor-next', isDone: false };
              },
            }
          }

          throw new Error(`Unexpected table query: ${tableName}`)
        },
        async patch(id: string, value: { reviewedResumeIds: string[] }) {
          await patch(id, value)
        },
        async delete(id: string) {
          deletedIds.push(id)
          resumes.delete(id)
        },
      },
    }

    const result = await deleteResumesHandler(ctx as never, { resumeIds: ['resume-1', ' resume-2 ', 'resume-1', 'resume-missing'] })

    expect(result).toEqual({
      requested: 3,
      deleted: 2,
      missingResumeIds: ['resume-missing'],
      deletedAiTaggingResults: 3,
      patchedScreeningSessions: 2,
    })
    expect(deletedIds).toEqual(['tag-1', 'tag-2', 'tag-3', 'resume-1', 'resume-2'])
    expect(patch).toHaveBeenCalledTimes(2)
    expect(screeningSessions).toEqual([
      { _id: 'session-1', reviewedResumeIds: ['keep-me'] },
      { _id: 'session-2', reviewedResumeIds: [] },
      { _id: 'session-3', reviewedResumeIds: ['keep-me'] },
    ])
  })

  it('reports invalid and already-missing resume ids without deleting anything', async () => {
    const patch = vi.fn()
    const deleteSpy = vi.fn()

    const ctx = {
      db: {
        normalizeId(tableName: string, id: string) {
          expect(tableName).toBe('resumes')
          if (id === 'resume-gone') {
            return 'resume-gone'
          }
          return null
        },
        async get() {
          return null
        },
        query(tableName: string) {
          if (tableName === 'screening_sessions') {
            return {
              async collect() {
                return []
              },
              async paginate() {
                return { page: [], continueCursor: null, isDone: true }
              },
            }
          }
          if (tableName === 'ai_tagging_results') {
            return {
              withIndex() {
                return {
                  async collect() {
                    return []
                  },
                }
              },
            }
          }
          throw new Error(`Unexpected table query: ${tableName}`)
        },
        async patch(...args: unknown[]) {
          patch(...args)
        },
        async delete(...args: unknown[]) {
          deleteSpy(...args)
        },
      },
    }

    const result = await deleteResumesHandler(ctx as never, { resumeIds: ['resume-gone', 'not-a-resume-id', ' '] })

    expect(result).toEqual({
      requested: 2,
      deleted: 0,
      missingResumeIds: ['not-a-resume-id', 'resume-gone'],
      deletedAiTaggingResults: 0,
      patchedScreeningSessions: 0,
    })
    expect(patch).not.toHaveBeenCalled()
    expect(deleteSpy).not.toHaveBeenCalled()
  })
})
