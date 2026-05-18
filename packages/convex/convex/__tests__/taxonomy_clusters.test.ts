import { afterEach, describe, expect, it, vi } from "vitest"

import { list, remove, suggest, upsert } from "../taxonomy_clusters"

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

type TaxonomyRecord = {
  _id: string
  workspaceSlug: string
  name: string
  slug: string
  parentSlug?: string
  tags: string[]
  source: "human" | "ai" | "merged"
  confidence?: number
  status: "active" | "draft" | "archived"
  createdAt: number
  updatedAt: number
}

type ResumeRecord = {
  _id: string
  ingestData?: {
    industryTags?: string[]
  }
}

const listHandler = (list as unknown as ConvexHandler<
  {
    workspaceSlug?: string
    status?: "active" | "draft" | "archived"
  },
  TaxonomyRecord[]
>)._handler

const upsertHandler = (upsert as unknown as ConvexHandler<
  {
    id?: string
    workspaceSlug?: string
    name: string
    slug: string
    parentSlug?: string
    tags: string[]
    source: "human" | "ai" | "merged"
    confidence?: number
    status: "active" | "draft" | "archived"
  },
  TaxonomyRecord | null
>)._handler

const removeHandler = (remove as unknown as ConvexHandler<
  { id: string; workspaceSlug?: string },
  boolean
>)._handler

const suggestHandler = (suggest as unknown as ConvexHandler<
  { workspaceSlug?: string; limit?: number },
  TaxonomyRecord[]
>)._handler

function cloneTaxonomyRecord(record: TaxonomyRecord): TaxonomyRecord {
  return {
    ...record,
    tags: [...record.tags],
  }
}

function cloneResumeRecord(record: ResumeRecord): ResumeRecord {
  return {
    ...record,
    ingestData: record.ingestData
      ? {
          ...record.ingestData,
          industryTags: [...(record.ingestData.industryTags ?? [])],
        }
      : undefined,
  }
}

function createTaxonomyDb(
  taxonomyRecords: TaxonomyRecord[],
  resumes: ResumeRecord[] = [],
) {
  const records = taxonomyRecords.map(cloneTaxonomyRecord)
  const resumeRecords = resumes.map(cloneResumeRecord)
  const insertedRecords: Array<Record<string, unknown>> = []
  const patchedRecords: Array<{ id: string; patch: Record<string, unknown> }> = []
  const deletedIds: string[] = []
  let nextId = 1

  return {
    insertedRecords,
    patchedRecords,
    deletedIds,
    records,
    db: {
      query(tableName: string) {
        if (tableName === "taxonomy_clusters") {
          return {
            withIndex(
              indexName: string,
              apply: (
                q: {
                  eq: (
                    field: string,
                    value: string,
                  ) => {
                    eq: (field: string, value: string) => unknown
                    clauses: Array<{ field: string; value: string }>
                  }
                },
              ) => { clauses: Array<{ field: string; value: string }> },
            ) {
              expect(
                indexName === "by_workspace" ||
                  indexName === "by_workspace_slug" ||
                  indexName === "by_workspace_status",
              ).toBe(true)

              const clauses: Array<{ field: string; value: string }> = []
              const clauseBuilder: {
                eq: (
                  field: string,
                  value: string,
                ) => {
                  eq: (field: string, value: string) => unknown
                  clauses: Array<{ field: string; value: string }>
                }
                clauses: Array<{ field: string; value: string }>
              } = {
                clauses,
                eq(field: string, value: string) {
                  clauses.push({ field, value })
                  return this
                },
              }
              apply(clauseBuilder)

              const matches = () =>
                records
                  .filter((record) =>
                    clauses.every(
                      (clause) => String(record[clause.field as keyof TaxonomyRecord] ?? "") === clause.value,
                    ),
                  )
                  .map(cloneTaxonomyRecord)

              return {
                async collect() {
                  return matches()
                },
                async unique() {
                  return matches()[0] ?? null
                },
                async take(n: number) {
                  return matches().slice(0, n)
                },
              }
            },
          }
        }

        if (tableName === "resumes") {
          return {
            async collect() {
              return resumeRecords.map(cloneResumeRecord)
            },
            order() {
              return {
                async take(n: number) {
                  return resumeRecords.map(cloneResumeRecord).slice(0, n)
                },
              }
            },
          }
        }

        throw new Error(`Unexpected table query: ${tableName}`)
      },
      async get(id: string) {
        const record = records.find((entry) => entry._id === id)
        return record ? cloneTaxonomyRecord(record) : null
      },
      async patch(id: string, patch: Record<string, unknown>) {
        patchedRecords.push({ id, patch })
        const record = records.find((entry) => entry._id === id)
        if (!record) {
          throw new Error(`Missing taxonomy cluster ${id}`)
        }

        Object.assign(record, patch, {
          tags: Array.isArray(patch.tags) ? [...(patch.tags as string[])] : record.tags,
        })
      },
      async insert(tableName: string, value: Record<string, unknown>) {
        expect(tableName).toBe("taxonomy_clusters")
        insertedRecords.push(value)
        const id = `cluster-new-${nextId++}`
        records.push({
          _id: id,
          workspaceSlug: String(value.workspaceSlug),
          name: String(value.name),
          slug: String(value.slug),
          parentSlug: typeof value.parentSlug === "string" ? value.parentSlug : undefined,
          tags: Array.isArray(value.tags) ? [...(value.tags as string[])] : [],
          source: value.source as TaxonomyRecord["source"],
          confidence: typeof value.confidence === "number" ? value.confidence : undefined,
          status: value.status as TaxonomyRecord["status"],
          createdAt: Number(value.createdAt),
          updatedAt: Number(value.updatedAt),
        })
        return id
      },
      async delete(id: string) {
        deletedIds.push(id)
        const index = records.findIndex((entry) => entry._id === id)
        if (index >= 0) {
          records.splice(index, 1)
        }
      },
    },
  }
}

describe("taxonomy cluster mutations", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("lists only the requested workspace and sorts by status then recency", async () => {
    const result = await listHandler(
      createTaxonomyDb([
        {
          _id: "dev-older-active",
          workspaceSlug: "dev",
          name: "Older Active",
          slug: "older-active",
          tags: ["Machine Tools"],
          source: "human",
          status: "active",
          createdAt: 1,
          updatedAt: 10,
        },
        {
          _id: "dev-newer-active",
          workspaceSlug: "dev",
          name: "Newer Active",
          slug: "newer-active",
          tags: ["Automation"],
          source: "human",
          status: "active",
          createdAt: 2,
          updatedAt: 20,
        },
        {
          _id: "dev-draft",
          workspaceSlug: "dev",
          name: "Draft",
          slug: "draft",
          tags: ["Robotics"],
          source: "ai",
          status: "draft",
          createdAt: 3,
          updatedAt: 30,
        },
        {
          _id: "dev-archived",
          workspaceSlug: "dev",
          name: "Archived",
          slug: "archived",
          tags: ["Sales"],
          source: "merged",
          status: "archived",
          createdAt: 4,
          updatedAt: 40,
        },
        {
          _id: "hr-active",
          workspaceSlug: "hr",
          name: "HR Active",
          slug: "hr-active",
          tags: ["Recruiting"],
          source: "human",
          status: "active",
          createdAt: 5,
          updatedAt: 50,
        },
      ]) as never,
      { workspaceSlug: "dev" },
    )

    expect(result.map((record) => record._id)).toEqual([
      "dev-newer-active",
      "dev-older-active",
      "dev-draft",
      "dev-archived",
    ])

    const activeOnly = await listHandler(
      createTaxonomyDb([
        {
          _id: "dev-active",
          workspaceSlug: "dev",
          name: "Active",
          slug: "active",
          tags: ["Automation"],
          source: "human",
          status: "active",
          createdAt: 1,
          updatedAt: 20,
        },
        {
          _id: "dev-draft",
          workspaceSlug: "dev",
          name: "Draft",
          slug: "draft",
          tags: ["Robotics"],
          source: "ai",
          status: "draft",
          createdAt: 2,
          updatedAt: 10,
        },
      ]) as never,
      { workspaceSlug: "dev", status: "active" },
    )

    expect(activeOnly.map((record) => record._id)).toEqual(["dev-active"])
  })

  it("normalizes slug lineage and deduplicated tags during upsert", async () => {
    const now = Date.UTC(2026, 2, 27, 15, 0, 0)
    vi.spyOn(Date, "now").mockReturnValue(now)

    const ctx = createTaxonomyDb([])
    const result = await upsertHandler(ctx as never, {
      workspaceSlug: "dev",
      name: "Backend Languages",
      slug: " Backend Languages ",
      parentSlug: " Core Domains ",
      tags: ["Go", "go", " Rust ", "Rust"],
      source: "human",
      confidence: 0.82,
      status: "active",
    })

    expect(result?._id).toBe("cluster-new-1")
    expect(ctx.insertedRecords).toEqual([
      {
        workspaceSlug: "dev",
        name: "Backend Languages",
        slug: "backend-languages",
        parentSlug: "core-domains",
        tags: ["Go", "Rust"],
        source: "human",
        confidence: 0.82,
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    ])
  })

  it("rejects cross-workspace upserts when the requested id belongs to another workspace", async () => {
    const ctx = createTaxonomyDb([
      {
        _id: "hr-cluster",
        workspaceSlug: "hr",
        name: "HR Cluster",
        slug: "hr-cluster",
        tags: ["Recruiting"],
        source: "human",
        status: "active",
        createdAt: 1,
        updatedAt: 2,
      },
    ])

    await expect(
      upsertHandler(ctx as never, {
        id: "hr-cluster",
        workspaceSlug: "dev",
        name: "HR Cluster",
        slug: "hr-cluster",
        tags: ["Recruiting"],
        source: "human",
        status: "active",
      }),
    ).rejects.toThrow("Taxonomy cluster not found in workspace")

    expect(ctx.patchedRecords).toEqual([])
    expect(ctx.insertedRecords).toEqual([])
  })

  it("removes only records from the requested workspace", async () => {
    const ctx = createTaxonomyDb([
      {
        _id: "dev-cluster",
        workspaceSlug: "dev",
        name: "Dev Cluster",
        slug: "dev-cluster",
        tags: ["Automation"],
        source: "human",
        status: "active",
        createdAt: 1,
        updatedAt: 2,
      },
      {
        _id: "hr-cluster",
        workspaceSlug: "hr",
        name: "HR Cluster",
        slug: "hr-cluster",
        tags: ["Recruiting"],
        source: "human",
        status: "active",
        createdAt: 3,
        updatedAt: 4,
      },
    ])

    const blocked = await removeHandler(ctx as never, {
      id: "hr-cluster",
      workspaceSlug: "dev",
    })
    expect(blocked).toBe(false)
    expect(ctx.deletedIds).toEqual([])

    const removed = await removeHandler(ctx as never, {
      id: "dev-cluster",
      workspaceSlug: "dev",
    })
    expect(removed).toBe(true)
    expect(ctx.deletedIds).toEqual(["dev-cluster"])
  })

  it("suggests grouped drafts and merges into existing human clusters", async () => {
    const now = Date.UTC(2026, 2, 27, 16, 0, 0)
    vi.spyOn(Date, "now").mockReturnValue(now)

    const ctx = createTaxonomyDb(
      [
        {
          _id: "existing-cnc",
          workspaceSlug: "dev",
          name: "CNC",
          slug: "cnc",
          tags: ["CNC Milling"],
          source: "human",
          confidence: 0.9,
          status: "active",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      [
        {
          _id: "resume-1",
          ingestData: {
            industryTags: ["CNC Grinding", "Robotics Vision", "CNC Grinding"],
          },
        },
        {
          _id: "resume-2",
          ingestData: {
            industryTags: ["CNC Lathe", "Robotics Programming"],
          },
        },
        {
          _id: "resume-3",
          ingestData: {
            industryTags: ["Robotics Vision"],
          },
        },
      ],
    )

    const result = await suggestHandler(ctx as never, {
      workspaceSlug: "dev",
      limit: 4,
    })

    expect(ctx.patchedRecords).toEqual([
      {
        id: "existing-cnc",
        patch: {
          tags: ["CNC Milling", "CNC Grinding", "CNC Lathe"],
          source: "human",
          confidence: 0.25,
          status: "active",
          updatedAt: now,
        },
      },
    ])
    expect(ctx.insertedRecords).toEqual([
      {
        workspaceSlug: "dev",
        name: "Robotics",
        slug: "robotics",
        tags: ["Robotics Vision", "Robotics Programming"],
        source: "merged",
        confidence: 0.25,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      },
    ])
    expect(result.map((record) => record.slug)).toEqual(["robotics", "cnc"])
    expect(result.find((record) => record.slug === "cnc")?.tags).toEqual([
      "CNC Milling",
      "CNC Grinding",
      "CNC Lathe",
    ])
  })
})
