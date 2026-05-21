import { describe, expect, it, vi } from 'vitest'

import { archiveResumes, unarchiveResumes } from '../resumes'

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

type ArchiveResumesResult = {
  requested: number
  archived: number
  alreadyArchived: number
  missingResumeIds: string[]
}

type UnarchiveResumesResult = {
  requested: number
  unarchived: number
  notArchived: number
  missingResumeIds: string[]
}

const archiveHandler = (archiveResumes as unknown as ConvexHandler<
  { resumeIds: string[] },
  ArchiveResumesResult
>)._handler

const unarchiveHandler = (unarchiveResumes as unknown as ConvexHandler<
  { resumeIds: string[] },
  UnarchiveResumesResult
>)._handler

describe('archiveResumes', () => {
  it('archives active resumes and reports already-archived ones', async () => {
    const resumes = new Map([
      ['r1', { _id: 'r1', content: { name: 'Alice' } }],
      ['r2', { _id: 'r2', content: { name: 'Bob' }, isArchived: true }],
      ['r3', { _id: 'r3', content: { name: 'Carol' } }],
    ])
    const patched: Array<{ id: string; data: Record<string, unknown> }> = []

    const ctx = {
      db: {
        normalizeId(_table: string, id: string) {
          return ['r1', 'r2', 'r3'].includes(id) ? id : null
        },
        async get(id: string) {
          return resumes.get(id) ?? null
        },
        async patch(id: string, data: Record<string, unknown>) {
          patched.push({ id, data })
          const resume = resumes.get(id)
          if (resume) Object.assign(resume, data)
        },
      },
    }

    const result = await archiveHandler(ctx as never, {
      resumeIds: ['r1', 'r2', 'r3'],
    })

    expect(result.requested).toBe(3)
    expect(result.archived).toBe(2)
    expect(result.alreadyArchived).toBe(1)
    expect(result.missingResumeIds).toEqual([])
    expect(patched).toHaveLength(2)
    expect(patched[0].id).toBe('r1')
    expect(patched[0].data.isArchived).toBe(true)
    expect(typeof patched[0].data.archivedAt).toBe('number')
  })

  it('deduplicates and trims resume ids', async () => {
    const resumes = new Map([
      ['r1', { _id: 'r1', content: { name: 'Alice' } }],
    ])
    const patched: Array<{ id: string; data: Record<string, unknown> }> = []

    const ctx = {
      db: {
        normalizeId(_table: string, id: string) {
          return id === 'r1' ? id : null
        },
        async get(id: string) {
          return resumes.get(id) ?? null
        },
        async patch(id: string, data: Record<string, unknown>) {
          patched.push({ id, data })
        },
      },
    }

    const result = await archiveHandler(ctx as never, {
      resumeIds: [' r1 ', 'r1', 'r1'],
    })

    // normalizeRequestedResumeIds deduplicates and trims
    expect(result.requested).toBe(1)
    expect(result.archived).toBe(1)
  })

  it('reports missing and non-existent resume ids', async () => {
    const ctx = {
      db: {
        normalizeId(_table: string, id: string) {
          return id === 'r1' ? id : null
        },
        async get() {
          return null
        },
        async patch() {},
      },
    }

    const result = await archiveHandler(ctx as never, {
      resumeIds: ['r1', 'missing-id'],
    })

    expect(result.requested).toBe(2)
    expect(result.archived).toBe(0)
    expect(result.missingResumeIds).toEqual(['missing-id', 'r1'])
  })

  it('returns zeros for empty input', async () => {
    const ctx = {
      db: {
        normalizeId() { return null },
        async get() { return null },
        async patch() {},
      },
    }

    const result = await archiveHandler(ctx as never, { resumeIds: [] })

    expect(result).toEqual({
      requested: 0,
      archived: 0,
      alreadyArchived: 0,
      missingResumeIds: [],
    })
  })
})

describe('unarchiveResumes', () => {
  it('unarchives previously archived resumes', async () => {
    const resumes = new Map([
      ['r1', { _id: 'r1', content: { name: 'Alice' }, isArchived: true, archivedAt: 1700000000000 }],
      ['r2', { _id: 'r2', content: { name: 'Bob' } }],
    ])
    const patched: Array<{ id: string; data: Record<string, unknown> }> = []

    const ctx = {
      db: {
        normalizeId(_table: string, id: string) {
          return ['r1', 'r2'].includes(id) ? id : null
        },
        async get(id: string) {
          return resumes.get(id) ?? null
        },
        async patch(id: string, data: Record<string, unknown>) {
          patched.push({ id, data })
          const resume = resumes.get(id)
          if (resume) Object.assign(resume, data)
        },
      },
    }

    const result = await unarchiveHandler(ctx as never, {
      resumeIds: ['r1', 'r2'],
    })

    expect(result.requested).toBe(2)
    expect(result.unarchived).toBe(1)
    expect(result.notArchived).toBe(1)
    expect(result.missingResumeIds).toEqual([])
    expect(patched).toHaveLength(1)
    expect(patched[0].id).toBe('r1')
    expect(patched[0].data.isArchived).toBeUndefined()
    expect(patched[0].data.archivedAt).toBeUndefined()
  })

  it('reports missing ids for non-existent resumes', async () => {
    const ctx = {
      db: {
        normalizeId(_table: string, id: string) {
          return id === 'r1' ? id : null
        },
        async get() {
          return null
        },
        async patch() {},
      },
    }

    const result = await unarchiveHandler(ctx as never, {
      resumeIds: ['r1', 'ghost'],
    })

    expect(result.requested).toBe(2)
    expect(result.unarchived).toBe(0)
    expect(result.missingResumeIds).toEqual(['ghost', 'r1'])
  })

  it('returns zeros for empty input', async () => {
    const ctx = {
      db: {
        normalizeId() { return null },
        async get() { return null },
        async patch() {},
      },
    }

    const result = await unarchiveHandler(ctx as never, { resumeIds: [] })

    expect(result).toEqual({
      requested: 0,
      unarchived: 0,
      notArchived: 0,
      missingResumeIds: [],
    })
  })
})
