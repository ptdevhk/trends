import { describe, expect, it } from "vitest";

import {
  clearAll,
  clearWorkspaceData,
  seedJobDescriptions,
  seedResumes,
} from "../seed";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

const seedJobDescriptionsHandler = (seedJobDescriptions as unknown as ConvexHandler<
  {
    items: Array<{
      title: string;
      slug?: string;
      content: string;
      type: "system" | "custom";
      workspaceSlug?: string;
      location?: string;
      customKeywords?: string[];
    }>;
  },
  { inserted: number; skipped: number; updated: number }
>)._handler

const seedResumesHandler = (seedResumes as unknown as ConvexHandler<
  {
    resumes: Array<{
      externalId: string;
      content: Record<string, unknown>;
      hash: string;
      source: string;
      tags: string[];
    }>;
  },
  { inserted: number; skipped: number }
>)._handler

const clearWorkspaceDataHandler = (clearWorkspaceData as unknown as ConvexHandler<
  { workspaceSlug?: string },
  {
    workspaceSlug: string;
    customJobDescriptions: number;
    searchProfiles: number;
    screeningSessions: number;
    searchHistory: number;
    workspaceConfig: number;
  }
>)._handler

const clearAllHandler = (clearAll as unknown as ConvexHandler<
  Record<string, never>,
  { success: boolean }
>)._handler

type JobDescriptionRecord = {
  _id: string;
  title: string;
  slug?: string;
  content: string;
  type: "system" | "custom";
  workspaceSlug?: string;
  enabled: boolean;
  lastModified?: number;
  location?: string;
  customKeywords?: string[];
}

type ResumeRecord = {
  _id: string;
  externalId: string;
  content: Record<string, unknown>;
  hash: string;
  source: string;
  tags: string[];
  identityKey?: string;
  searchText?: string;
  crawledAt?: number;
}

type GenericRecord = {
  _id: string;
  workspaceSlug?: string;
  tags?: string[];
}

function createSeedDb(options: {
  jobDescriptions?: JobDescriptionRecord[];
  resumes?: ResumeRecord[];
  searchProfiles?: GenericRecord[];
  screeningSessions?: GenericRecord[];
  searchHistory?: GenericRecord[];
  workspaceConfig?: GenericRecord[];
  collectionTasks?: GenericRecord[];
  analysisTasks?: GenericRecord[];
} = {}) {
  const inserts: Array<{ table: string; doc: Record<string, unknown> }> = []
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = []
  const deleted: string[] = []

  const jobDescriptions = options.jobDescriptions ?? []
  const resumes = options.resumes ?? []
  const searchProfiles = options.searchProfiles ?? []
  const screeningSessions = options.screeningSessions ?? []
  const searchHistory = options.searchHistory ?? []
  const workspaceConfig = options.workspaceConfig ?? []
  const collectionTasks = options.collectionTasks ?? []
  const analysisTasks = options.analysisTasks ?? []

  function queryTable(tableName: string) {
    const tableData: Array<Record<string, unknown>> =
      tableName === "job_descriptions" ? jobDescriptions :
      tableName === "resumes" ? resumes :
      tableName === "search_profiles" ? searchProfiles :
      tableName === "screening_sessions" ? screeningSessions :
      tableName === "search_history" ? searchHistory :
      tableName === "workspace_config" ? workspaceConfig :
      tableName === "collection_tasks" ? collectionTasks :
      tableName === "analysis_tasks" ? analysisTasks :
      []

    return {
      collect: async () => [...tableData],
      filter(apply: (q: { eq: (left: unknown, right: unknown) => unknown; field: (name: string) => string }) => unknown) {
        const clause = apply({
          eq: (left: unknown, right: unknown) => ({ left, right }),
          field: (name: string) => name,
        }) as { left: string; right: unknown }
        const filtered = tableData.filter((r) => r[clause.left] === clause.right)
        return { collect: async () => [...filtered] }
      },
      withIndex(_indexName: string, apply: (q: { eq: (field: string, value: string) => unknown }) => unknown) {
        const conditions: Array<{ field: string; value: string }> = []
        apply({
          eq(field: string, value: string) {
            conditions.push({ field, value })
            return this
          },
        })
        const filtered = tableData.filter((r) =>
          conditions.every((c) => r[c.field] === c.value)
        )
        return {
          unique: async () => filtered[0] ?? null,
          collect: async () => [...filtered],
        }
      },
    }
  }

  return {
    inserts,
    patches,
    deleted,
    db: {
      query: queryTable,
      async insert(table: string, doc: Record<string, unknown>) {
        inserts.push({ table, doc })
        return `inserted-${inserts.length}`
      },
      async patch(id: string, patch: Record<string, unknown>) {
        patches.push({ id, patch })
        const allRecords = [...jobDescriptions, ...resumes, ...searchProfiles, ...screeningSessions, ...searchHistory, ...workspaceConfig]
        const record = allRecords.find((r) => r._id === id)
        if (record) Object.assign(record, patch)
      },
      async delete(id: string) {
        deleted.push(id)
      },
    },
    scheduler: {
      async runAfter() {},
    },
  }
}

describe("seedJobDescriptions", () => {
  it("inserts new job descriptions", async () => {
    const ctx = createSeedDb()

    const result = await seedJobDescriptionsHandler(ctx as never, {
      items: [
        { title: "CNC Sales", content: "Job description content", type: "system" },
        { title: "Custom Role", content: "Custom content", type: "custom", workspaceSlug: "dev" },
      ],
    })

    expect(result.inserted).toBe(2)
    expect(result.skipped).toBe(0)
    expect(ctx.inserts).toHaveLength(2)
    expect(ctx.inserts[0].table).toBe("job_descriptions")
    expect(ctx.inserts[0].doc.title).toBe("CNC Sales")
    expect(ctx.inserts[0].doc.enabled).toBe(true)
  })

  it("skips existing job descriptions with identical content", async () => {
    const jobDescriptions: JobDescriptionRecord[] = [
      { _id: "jd1", title: "CNC Sales", content: "same content", type: "system", enabled: true },
    ]
    const ctx = createSeedDb({ jobDescriptions })

    const result = await seedJobDescriptionsHandler(ctx as never, {
      items: [
        { title: "CNC Sales", content: "same content", type: "system" },
      ],
    })

    expect(result.inserted).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.updated).toBe(0)
  })

  it("updates existing job descriptions when content changes", async () => {
    const jobDescriptions: JobDescriptionRecord[] = [
      { _id: "jd1", title: "CNC Sales", content: "old content", type: "system", enabled: true },
    ]
    const ctx = createSeedDb({ jobDescriptions })

    const result = await seedJobDescriptionsHandler(ctx as never, {
      items: [
        { title: "CNC Sales", content: "new content", type: "system" },
      ],
    })

    expect(result.inserted).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.updated).toBe(1)
    expect(ctx.patches).toHaveLength(1)
    expect(ctx.patches[0].id).toBe("jd1")
    expect(ctx.patches[0].patch.content).toBe("new content")
  })
})

describe("seedResumes", () => {
  it("inserts new resumes and schedules ingest", async () => {
    const scheduled: Array<{ delay: number; fn: unknown; args: unknown }> = []
    const ctx = {
      ...createSeedDb(),
      scheduler: {
        async runAfter(delay: number, fn: unknown, args: unknown) {
          scheduled.push({ delay, fn, args })
        },
      },
    }

    const result = await seedResumesHandler(ctx as never, {
      resumes: [
        {
          externalId: "ext-1",
          content: { name: "Alice" },
          hash: "abc123",
          source: "test",
          tags: ["demo"],
        },
      ],
    })

    expect(result.inserted).toBe(1)
    expect(result.skipped).toBe(0)
    expect(ctx.inserts).toHaveLength(1)
    expect(ctx.inserts[0].doc.externalId).toBe("ext-1")
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0].args).toEqual({ resumeIds: ["inserted-1"] })
  })

  it("skips resumes that already exist by identityKey", async () => {
    const resumes: ResumeRecord[] = [
      {
        _id: "r1",
        externalId: "ext-1",
        content: { name: "Alice" },
        hash: "old-hash",
        source: "test",
        tags: ["demo"],
        identityKey: "identity-key-1",
        searchText: "alice",
      },
    ]
    const ctx = createSeedDb({ resumes })

    const result = await seedResumesHandler(ctx as never, {
      resumes: [
        {
          externalId: "ext-1",
          content: { name: "Alice" },
          hash: "new-hash",
          source: "test",
          tags: ["demo"],
        },
      ],
    })

    expect(result.inserted).toBe(0)
    expect(result.skipped).toBe(1)
  })

  it("merges tags when updating existing resumes", async () => {
    const resumes: ResumeRecord[] = [
      {
        _id: "r1",
        externalId: "ext-1",
        content: { name: "Alice" },
        hash: "old-hash",
        source: "test",
        tags: ["demo"],
        identityKey: "identity-key-1",
        searchText: "alice",
      },
    ]
    const ctx = createSeedDb({ resumes })

    await seedResumesHandler(ctx as never, {
      resumes: [
        {
          externalId: "ext-1",
          content: { name: "Alice" },
          hash: "new-hash",
          source: "test",
          tags: ["new-tag"],
        },
      ],
    })

    // Tags should be merged
    const tagPatch = ctx.patches.find((p) => "tags" in p.patch)
    expect(tagPatch).toBeDefined()
    expect(tagPatch!.patch.tags).toEqual(expect.arrayContaining(["demo", "new-tag"]))
  })
})

describe("clearWorkspaceData", () => {
  it("deletes custom JDs and search profiles for the default workspace", async () => {
    const jobDescriptions: JobDescriptionRecord[] = [
      { _id: "jd1", title: "Custom JD", content: "c", type: "custom", workspaceSlug: "dev", enabled: true },
      { _id: "jd2", title: "System JD", content: "s", type: "system", enabled: true },
      { _id: "jd3", title: "HR JD", content: "h", type: "custom", workspaceSlug: "hr", enabled: true },
    ]
    const searchProfiles: GenericRecord[] = [
      { _id: "sp1", workspaceSlug: "dev" },
      { _id: "sp2", workspaceSlug: "hr" },
    ]
    const screeningSessions: GenericRecord[] = [
      { _id: "ss1", workspaceSlug: "dev" },
    ]
    const searchHistory: GenericRecord[] = [
      { _id: "sh1", workspaceSlug: "dev" },
    ]
    const workspaceConfig: GenericRecord[] = [
      { _id: "wc1", workspaceSlug: "dev" },
    ]

    const ctx = createSeedDb({
      jobDescriptions,
      searchProfiles,
      screeningSessions,
      searchHistory,
      workspaceConfig,
    })

    const result = await clearWorkspaceDataHandler(ctx as never, { workspaceSlug: "dev" })

    expect(result.workspaceSlug).toBe("dev")
    expect(result.customJobDescriptions).toBe(1) // jd1 (dev custom)
    expect(result.searchProfiles).toBe(1) // sp1
    expect(result.screeningSessions).toBe(1) // ss1
    expect(result.searchHistory).toBe(1) // sh1
    expect(result.workspaceConfig).toBe(1) // wc1
  })

  it("only deletes data for the specified non-default workspace", async () => {
    const jobDescriptions: JobDescriptionRecord[] = [
      { _id: "jd1", title: "HR Custom", content: "c", type: "custom", workspaceSlug: "hr", enabled: true },
      { _id: "jd2", title: "Dev Custom", content: "d", type: "custom", workspaceSlug: "dev", enabled: true },
    ]
    const searchProfiles: GenericRecord[] = [
      { _id: "sp1", workspaceSlug: "hr" },
      { _id: "sp2", workspaceSlug: "dev" },
    ]

    const ctx = createSeedDb({ jobDescriptions, searchProfiles })

    const result = await clearWorkspaceDataHandler(ctx as never, { workspaceSlug: "hr" })

    expect(result.customJobDescriptions).toBe(1) // jd1 only
    expect(result.searchProfiles).toBe(1) // sp1 only
    // Verify dev data was NOT deleted
    expect(ctx.deleted).not.toContain("jd2")
    expect(ctx.deleted).not.toContain("sp2")
  })
})

describe("clearAll", () => {
  it("deletes all data from every table", async () => {
    const ctx = createSeedDb({
      jobDescriptions: [{ _id: "jd1", title: "Test", content: "c", type: "system", enabled: true }],
      resumes: [{ _id: "r1", externalId: "1", content: {}, hash: "h", source: "s", tags: [] }],
      collectionTasks: [{ _id: "ct1" }],
      analysisTasks: [{ _id: "at1" }],
      searchProfiles: [{ _id: "sp1", workspaceSlug: "dev" }],
      screeningSessions: [{ _id: "ss1", workspaceSlug: "dev" }],
      searchHistory: [{ _id: "sh1", workspaceSlug: "dev" }],
      workspaceConfig: [{ _id: "wc1", workspaceSlug: "dev" }],
    })

    const result = await clearAllHandler(ctx as never, {})

    expect(result.success).toBe(true)
    expect(ctx.deleted).toHaveLength(8)
  })
})
