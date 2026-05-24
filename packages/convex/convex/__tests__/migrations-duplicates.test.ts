import { describe, expect, it } from "vitest";

import {
  auditDuplicateResumesByIdentity,
  backfillTaggingEnvelope,
  mergeDuplicateResumesByIdentity,
} from "../migrations";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

const auditDuplicatesHandler = (auditDuplicateResumesByIdentity as unknown as ConvexHandler<
  { cursor?: string; batchSize?: number },
  {
    scannedResumes: number;
    duplicateGroupCount: number;
    duplicateResumeCount: number;
    groups: Array<{
      identityKey: string;
      count: number;
      canonicalId: string;
      duplicateIds: string[];
    }>;
    hasMore: boolean;
    cursor: string | null;
  }
>)._handler

const mergeDuplicatesHandler = (mergeDuplicateResumesByIdentity as unknown as ConvexHandler<
  { dryRun: boolean; batchSize: number; cursor?: string },
  {
    dryRun: boolean;
    scannedResumes: number;
    duplicateGroupCount: number;
    processedGroupCount: number;
    patchedCanonicals: number;
    deleted: number;
    groups: Array<{
      identityKey: string;
      canonicalId: string;
      duplicateIds: string[];
      duplicateCount: number;
      mergedTagCount: number;
      mergedAnalysisCount: number;
    }>;
    hasMore: boolean;
    cursor: string | null;
  }
>)._handler

const backfillTaggingHandler = (backfillTaggingEnvelope as unknown as ConvexHandler<
  { cursor?: string; batchSize?: number },
  {
    scannedResumes: number;
    updatedResumes: number;
    hasMore: boolean;
    cursor: string | null;
  }
>)._handler

type ResumeRecord = {
  _id: string;
  content: Record<string, unknown>;
  searchText?: string;
  tags?: string[];
  identityKey?: string;
  crawledAt?: number;
  analyses?: Record<string, unknown>;
  analysis?: unknown;
  ingestData?: {
    evidenceText?: string;
    industryTags: string[];
    synonymHits: string[];
    ruleScores: Record<string, number>;
    experienceLevel: string;
    computedAt: number;
    skillsVersion: number;
    taggingEnvelope?: unknown;
    [key: string]: unknown;
  };
}

function createPaginatedDb(records: ResumeRecord[], isDone = true, continueCursor = "cursor:done") {
  const patches: Array<{ id: string; patch: Partial<ResumeRecord> }> = []
  const deleted: string[] = []

  return {
    patches,
    deleted,
    db: {
      query(tableName: string) {
        expect(tableName).toBe("resumes")
        return {
          order(direction: "asc" | "desc") {
            expect(direction).toBe("desc")
            return {
              async paginate() {
                return {
                  page: records.map((record) => ({ ...record })),
                  isDone,
                  continueCursor,
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
      async delete(id: string) {
        deleted.push(id)
      },
    },
  }
}

describe("auditDuplicateResumesByIdentity", () => {
  it("returns empty groups when all resumes have unique identity keys", async () => {
    const records: ResumeRecord[] = [
      { _id: "r1", content: {}, identityKey: "key-a", crawledAt: 100 },
      { _id: "r2", content: {}, identityKey: "key-b", crawledAt: 200 },
    ]
    const ctx = createPaginatedDb(records)

    const result = await auditDuplicatesHandler(ctx as never, {})

    expect(result.scannedResumes).toBe(2)
    expect(result.duplicateGroupCount).toBe(0)
    expect(result.duplicateResumeCount).toBe(0)
    expect(result.groups).toEqual([])
    expect(result.hasMore).toBe(false)
    expect(result.cursor).toBeNull()
  })

  it("groups resumes by identityKey and identifies duplicates", async () => {
    const records: ResumeRecord[] = [
      { _id: "r1", content: { name: "Alice" }, identityKey: "same-key", crawledAt: 300, tags: ["tag1"] },
      { _id: "r2", content: { name: "Alice Dup" }, identityKey: "same-key", crawledAt: 200, tags: [] },
      { _id: "r3", content: {}, identityKey: "unique-key", crawledAt: 100 },
    ]
    const ctx = createPaginatedDb(records)

    const result = await auditDuplicatesHandler(ctx as never, {})

    expect(result.scannedResumes).toBe(3)
    expect(result.duplicateGroupCount).toBe(1)
    expect(result.duplicateResumeCount).toBe(1)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].identityKey).toBe("same-key")
    expect(result.groups[0].count).toBe(2)
    // Canonical should be r1 (higher crawledAt)
    expect(result.groups[0].canonicalId).toBe("r1")
    expect(result.groups[0].duplicateIds).toEqual(["r2"])
  })

  it("picks canonical by crawledAt then analysis richness", async () => {
    const records: ResumeRecord[] = [
      { _id: "r1", content: {}, identityKey: "dup-key", crawledAt: 100, analyses: { jd1: {} } },
      { _id: "r2", content: {}, identityKey: "dup-key", crawledAt: 100, analyses: { jd1: {}, jd2: {} } },
      { _id: "r3", content: {}, identityKey: "dup-key", crawledAt: 100 },
    ]
    const ctx = createPaginatedDb(records)

    const result = await auditDuplicatesHandler(ctx as never, {})

    // r2 has most analysis richness, should be canonical
    expect(result.groups[0].canonicalId).toBe("r2")
    expect(result.groups[0].duplicateIds).toHaveLength(2)
    expect(result.groups[0].duplicateIds).toContain("r1")
    expect(result.groups[0].duplicateIds).toContain("r3")
  })
})

describe("mergeDuplicateResumesByIdentity", () => {
  it("in dry-run mode, reports groups without patching or deleting", async () => {
    const records: ResumeRecord[] = [
      { _id: "r1", content: { name: "Alice" }, identityKey: "dup-key", crawledAt: 300, tags: ["a", "b"] },
      { _id: "r2", content: { name: "Alice Dup" }, identityKey: "dup-key", crawledAt: 200, tags: ["b", "c"] },
      { _id: "r3", content: {}, identityKey: "unique", crawledAt: 100 },
    ]
    const ctx = createPaginatedDb(records)

    const result = await mergeDuplicatesHandler(ctx as never, { dryRun: true, batchSize: 10 })

    expect(result.dryRun).toBe(true)
    expect(result.scannedResumes).toBe(3)
    expect(result.duplicateGroupCount).toBe(1)
    expect(result.processedGroupCount).toBe(1)
    expect(result.patchedCanonicals).toBe(0)
    expect(result.deleted).toBe(0)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].identityKey).toBe("dup-key")
    expect(result.groups[0].mergedTagCount).toBe(3) // "a", "b", "c" deduplicated
    // No actual patches or deletes
    expect(ctx.patches).toHaveLength(0)
    expect(ctx.deleted).toHaveLength(0)
  })

  it("in live mode, patches canonical and deletes duplicates", async () => {
    const records: ResumeRecord[] = [
      { _id: "r1", content: { name: "Alice" }, identityKey: "dup-key", crawledAt: 300, tags: ["a", "b"] },
      { _id: "r2", content: { name: "Alice Dup" }, identityKey: "dup-key", crawledAt: 200, tags: ["b", "c"] },
      { _id: "r3", content: {}, identityKey: "unique", crawledAt: 100 },
    ]
    const ctx = createPaginatedDb(records)

    const result = await mergeDuplicatesHandler(ctx as never, { dryRun: false, batchSize: 10 })

    expect(result.dryRun).toBe(false)
    expect(result.patchedCanonicals).toBe(1)
    expect(result.deleted).toBe(1)
    // Canonical r1 should be patched with merged tags
    expect(ctx.patches).toHaveLength(1)
    expect(ctx.patches[0].id).toBe("r1")
    const patchTags = ctx.patches[0].patch.tags
    expect(patchTags).toEqual(expect.arrayContaining(["a", "b", "c"]))
    expect(patchTags).toHaveLength(3)
    // Duplicate r2 should be deleted
    expect(ctx.deleted).toEqual(["r2"])
  })

  it("merges analyses from duplicates into canonical", async () => {
    const records: ResumeRecord[] = [
      {
        _id: "r1",
        content: {},
        identityKey: "dup-key",
        crawledAt: 300,
        tags: [],
        analyses: { jd1: { score: 80 } },
        analysis: { result: "primary" },
      },
      {
        _id: "r2",
        content: {},
        identityKey: "dup-key",
        crawledAt: 200,
        tags: [],
        analyses: { jd2: { score: 90 } },
      },
    ]
    const ctx = createPaginatedDb(records)

    const result = await mergeDuplicatesHandler(ctx as never, { dryRun: false, batchSize: 10 })

    expect(result.patchedCanonicals).toBe(1)
    expect(result.groups[0].mergedAnalysisCount).toBe(2)
    const patch = ctx.patches[0].patch as Record<string, unknown>
    const mergedAnalyses = patch.analyses as Record<string, unknown>
    expect("jd1" in mergedAnalyses).toBe(true)
    expect("jd2" in mergedAnalyses).toBe(true)
    expect(patch.analysis).toEqual({ result: "primary" })
  })

  it("respects batchSize to limit processed groups", async () => {
    const records: ResumeRecord[] = [
      { _id: "r1a", content: {}, identityKey: "key-a", crawledAt: 300, tags: ["a"] },
      { _id: "r1b", content: {}, identityKey: "key-a", crawledAt: 200, tags: [] },
      { _id: "r2a", content: {}, identityKey: "key-b", crawledAt: 300, tags: ["b"] },
      { _id: "r2b", content: {}, identityKey: "key-b", crawledAt: 200, tags: [] },
    ]
    const ctx = createPaginatedDb(records)

    const result = await mergeDuplicatesHandler(ctx as never, { dryRun: true, batchSize: 1 })

    expect(result.duplicateGroupCount).toBe(2)
    expect(result.processedGroupCount).toBe(1)
  })
})

describe("backfillTaggingEnvelope", () => {
  it("skips resumes without ingestData", async () => {
    const records: ResumeRecord[] = [
      { _id: "r1", content: {} },
    ]
    const ctx = createPaginatedDb(records)

    const result = await backfillTaggingHandler(ctx as never, {})

    expect(result.scannedResumes).toBe(1)
    expect(result.updatedResumes).toBe(0)
  })

  it("skips resumes that already have taggingEnvelope", async () => {
    const records: ResumeRecord[] = [
      {
        _id: "r1",
        content: {},
        ingestData: {
          industryTags: [],
          synonymHits: [],
          ruleScores: {},
          experienceLevel: "mid",
          computedAt: 1000,
          skillsVersion: 1,
          taggingEnvelope: { schemaVersion: 1, generatedAt: 1000, entries: [] },
        },
      },
    ]
    const ctx = createPaginatedDb(records)

    const result = await backfillTaggingHandler(ctx as never, {})

    expect(result.updatedResumes).toBe(0)
  })

  it("converts legacy tagEnvelope into proper taggingEnvelope with provenance", async () => {
    const records: ResumeRecord[] = [
      {
        _id: "r1",
        content: {},
        ingestData: {
          industryTags: [],
          synonymHits: [],
          ruleScores: {},
          experienceLevel: "mid",
          computedAt: 2000,
          skillsVersion: 1,
          // Legacy field: tagEnvelope (flat array without provenance)
          tagEnvelope: [
            { tag: "industry:machinery", source: "rule", confidence: 0.9, version: 1, evidence: ["cnc"] },
            { tag: "role:sales", source: "signal", confidence: 0.8, version: 1, evidence: [] },
            { tag: "custom", source: "manual", confidence: 0.5, version: 1 },
          ],
        },
      },
    ]
    const ctx = createPaginatedDb(records)

    const result = await backfillTaggingHandler(ctx as never, {})

    expect(result.updatedResumes).toBe(1)
    expect(ctx.patches).toHaveLength(1)
    const patch = ctx.patches[0].patch as Record<string, unknown>
    const ingestPatch = patch.ingestData as Record<string, unknown>
    const envelope = ingestPatch.taggingEnvelope as Record<string, unknown>

    expect(envelope.schemaVersion).toBe(1)
    expect(envelope.generatedAt).toBe(2000)
    const entries = envelope.entries as Array<Record<string, unknown>>
    expect(entries).toHaveLength(3)

    // industry: prefix → industry_taxonomy
    expect(entries[0].tag).toBe("industry:machinery")
    expect((entries[0].provenance as Record<string, unknown>).stage).toBe("industry_taxonomy")
    expect((entries[0].provenance as Record<string, unknown>).generatedBy).toBe("migration_backfill")

    // role: prefix → role_signal_aggregation
    expect(entries[1].tag).toBe("role:sales")
    expect((entries[1].provenance as Record<string, unknown>).stage).toBe("role_signal_aggregation")

    // no recognized prefix → unknown
    expect(entries[2].tag).toBe("custom")
    expect((entries[2].provenance as Record<string, unknown>).stage).toBe("unknown")
  })

  it("skips resumes with empty or non-array tagEnvelope", async () => {
    const records: ResumeRecord[] = [
      {
        _id: "r1",
        content: {},
        ingestData: {
          industryTags: [],
          synonymHits: [],
          ruleScores: {},
          experienceLevel: "mid",
          computedAt: 1000,
          skillsVersion: 1,
          tagEnvelope: [],
        },
      },
      {
        _id: "r2",
        content: {},
        ingestData: {
          industryTags: [],
          synonymHits: [],
          ruleScores: {},
          experienceLevel: "mid",
          computedAt: 1000,
          skillsVersion: 1,
          tagEnvelope: "not-an-array",
        },
      },
    ]
    const ctx = createPaginatedDb(records)

    const result = await backfillTaggingHandler(ctx as never, {})

    expect(result.updatedResumes).toBe(0)
  })

  it("uses computedAt value for generatedAt even when zero (?? only falls back on null/undefined)", async () => {
    const records: ResumeRecord[] = [
      {
        _id: "r1",
        content: {},
        ingestData: {
          industryTags: [],
          synonymHits: [],
          ruleScores: {},
          experienceLevel: "mid",
          computedAt: 0,
          skillsVersion: 1,
          tagEnvelope: [{ tag: "test", source: "rule", confidence: 0.5, version: 1 }],
        },
      },
    ]
    const ctx = createPaginatedDb(records)

    const result = await backfillTaggingHandler(ctx as never, {})

    expect(result.updatedResumes).toBe(1)
    const envelope = ((ctx.patches[0].patch as Record<string, unknown>).ingestData as Record<string, unknown>).taggingEnvelope as Record<string, unknown>
    // ?? only falls back on null/undefined, not 0 — so computedAt: 0 passes through
    expect(envelope.generatedAt).toBe(0)
  })

  it("falls back to Date.now() when computedAt is undefined", async () => {
    const before = Date.now()
    const records: ResumeRecord[] = [
      {
        _id: "r1",
        content: {},
        ingestData: {
          industryTags: [],
          synonymHits: [],
          ruleScores: {},
          experienceLevel: "mid",
          computedAt: undefined as unknown as number,
          skillsVersion: 1,
          tagEnvelope: [{ tag: "test", source: "rule", confidence: 0.5, version: 1 }],
        },
      },
    ]
    const ctx = createPaginatedDb(records)
    const after = Date.now()

    const result = await backfillTaggingHandler(ctx as never, {})

    expect(result.updatedResumes).toBe(1)
    const envelope = ((ctx.patches[0].patch as Record<string, unknown>).ingestData as Record<string, unknown>).taggingEnvelope as Record<string, unknown>
    expect(typeof envelope.generatedAt).toBe("number")
    expect(envelope.generatedAt as number).toBeGreaterThanOrEqual(before)
    expect(envelope.generatedAt as number).toBeLessThanOrEqual(after)
    void after // suppress unused warning
  })
})
