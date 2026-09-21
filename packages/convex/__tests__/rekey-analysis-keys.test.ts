/**
 * Convex-test coverage for migrations.rekeyResumeAnalysisKeys.
 *
 * The rekey copies each `resume_analyses.analyses` entry stored under a
 * prod-era source-only key (`source:<src>|analysis:<id>`) onto the
 * locale-segmented storage key (`source:<src>|locale:<loc>|analysis:<id>`),
 * leaving the originals intact. This keeps old prod blobs reachable through
 * the newest (locale-first) lookup after a clone+upgrade.
 *
 * See: task_72cd8665025e analysis-key migration.
 */
import { describe, expect, it } from "vitest";
import { createTest, seedResume, seedResumeAnalysesColdRow } from "./test-helpers.js";
import { internal } from "../convex/_generated/api.js";

const CMM_SOURCE_ONLY = "source:51job|analysis:keyword-search:2:4dc6f7f9";
const CMM_LOCALE = "source:51job|locale:zh-hans|analysis:keyword-search:2:4dc6f7f9";
const JOB5156_SOURCE_ONLY = "source:job5156|analysis:jd-exact";
const JOB5156_LOCALE = "source:job5156|locale:zh-hans|analysis:jd-exact";
const SEEK_SOURCE_ONLY = "source:seek|analysis:keyword-search:2:abcd1234";
const SEEK_LOCALE = "source:seek|locale:en|analysis:keyword-search:2:abcd1234";

function analysisValue(overrides: Record<string, unknown> = {}) {
  return {
    score: 88,
    summary: "CMM match",
    highlights: [],
    recommendation: "match",
    promptVersion: 14,
    locale: "zh-Hans",
    analyzedAt: 2_000,
    ...overrides,
  };
}

describe("migrations.rekeyResumeAnalysisKeys", () => {
  it("copies source-only entries onto the locale-segmented key and keeps originals", async () => {
    const t = createTest();
    const resumeId = await seedResume(t, {
      externalId: "rekey-51job-1",
      source: "ehire.51job.com",
      sourceKey: "51job",
    });
    await seedResumeAnalysesColdRow(t, resumeId, {
      analyses: {
        [CMM_SOURCE_ONLY]: analysisValue(),
      },
    });

    const result = await t.mutation(internal.migrations.rekeyResumeAnalysisKeys, {
      batchSize: 100,
    });
    expect(result).toMatchObject({ scanned: 1, updated: 1, copied: 1 });

    // Originals preserved AND locale-segmented copy present.
    const row = await t.run(async (ctx) =>
      ctx.db
        .query("resume_analyses")
        .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
        .unique(),
    );
    expect(row!.analyses![CMM_SOURCE_ONLY]).toBeDefined();
    expect(row!.analyses![CMM_LOCALE]).toBeDefined();
    expect(row!.analyses![CMM_LOCALE]).toEqual(row!.analyses![CMM_SOURCE_ONLY]);
  });

  it("is idempotent — a second run copies nothing new", async () => {
    const t = createTest();
    const resumeId = await seedResume(t, {
      externalId: "rekey-51job-2",
      source: "ehire.51job.com",
      sourceKey: "51job",
    });
    await seedResumeAnalysesColdRow(t, resumeId, {
      analyses: { [CMM_SOURCE_ONLY]: analysisValue() },
    });

    await t.mutation(internal.migrations.rekeyResumeAnalysisKeys, { batchSize: 100 });
    const result = await t.mutation(internal.migrations.rekeyResumeAnalysisKeys, {
      batchSize: 100,
    });
    // Second pass scans the row but has nothing new to copy (updated 0).
    expect(result).toMatchObject({ scanned: 1, updated: 0, copied: 0 });
  });

  it("uses seek→en and non-seek→zh-Hans for the locale segment", async () => {
    const t = createTest();
    const seekId = await seedResume(t, {
      externalId: "rekey-seek-1",
      source: "my.employer.seek.com",
      sourceKey: "seek",
    });
    await seedResumeAnalysesColdRow(t, seekId, {
      analyses: { [SEEK_SOURCE_ONLY]: analysisValue() },
    });
    const job5156Id = await seedResume(t, {
      externalId: "rekey-job5156-1",
      source: "hr.job5156.com",
      sourceKey: "job5156",
    });
    await seedResumeAnalysesColdRow(t, job5156Id, {
      analyses: { [JOB5156_SOURCE_ONLY]: analysisValue() },
    });

    const result = await t.mutation(internal.migrations.rekeyResumeAnalysisKeys, {
      batchSize: 100,
    });
    expect(result).toMatchObject({ scanned: 2, updated: 2, copied: 2 });

    const seekRow = await t.run(async (ctx) =>
      ctx.db.query("resume_analyses").withIndex("by_resume", (q) => q.eq("resumeId", seekId)).unique(),
    );
    expect(seekRow!.analyses![SEEK_LOCALE]).toBeDefined();

    const job5156Row = await t.run(async (ctx) =>
      ctx.db.query("resume_analyses").withIndex("by_resume", (q) => q.eq("resumeId", job5156Id)).unique(),
    );
    expect(job5156Row!.analyses![JOB5156_LOCALE]).toBeDefined();
  });

  it("does not clobber an existing locale-segmented key for the same source", async () => {
    const t = createTest();
    const resumeId = await seedResume(t, {
      externalId: "rekey-no-clobber",
      source: "ehire.51job.com",
      sourceKey: "51job",
    });
    const existing = analysisValue({ summary: "NEWER locale blob" });
    const old = analysisValue({ summary: "OLD prod blob" });
    await seedResumeAnalysesColdRow(t, resumeId, {
      analyses: {
        [CMM_LOCALE]: existing,
        [CMM_SOURCE_ONLY]: old,
      },
    });

    const result = await t.mutation(internal.migrations.rekeyResumeAnalysisKeys, {
      batchSize: 100,
    });
    // The locale key already exists → nothing copied for it; updated 0.
    expect(result).toMatchObject({ scanned: 1, updated: 0, copied: 0 });
    const row = await t.run(async (ctx) =>
      ctx.db.query("resume_analyses").withIndex("by_resume", (q) => q.eq("resumeId", resumeId)).unique(),
    );
    expect(row!.analyses![CMM_LOCALE]).toEqual(existing);
    expect(row!.analyses![CMM_SOURCE_ONLY]).toEqual(old);
  });

  it("skips bare (non-source-preixed) keys and archived rows", async () => {
    const t = createTest();
    const bareId = await seedResume(t, {
      externalId: "rekey-bare",
      source: "hr.job5156.com",
      sourceKey: "job5156",
    });
    await seedResumeAnalysesColdRow(t, bareId, {
      analyses: { "keyword-search:2:4dc6f7f9": analysisValue() },
    });
    const archivedId = await seedResume(t, {
      externalId: "rekey-archived",
      source: "ehire.51job.com",
      sourceKey: "51job",
    });
    await seedResumeAnalysesColdRow(t, archivedId, {
      status: "archived",
      analyses: { [CMM_SOURCE_ONLY]: analysisValue() },
    });

    const result = await t.mutation(internal.migrations.rekeyResumeAnalysisKeys, {
      batchSize: 100,
    });
    // Both rows scanned; neither produces a copy. Archived row skipped, bare-key
    // row has no source: prefix → nothing to segment.
    expect(result).toMatchObject({ scanned: 2, updated: 0, copied: 0 });
  });
});
