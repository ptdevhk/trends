/**
 * cjk-anomaly-probe (#7a): decisive probes for the 数控 anomaly (spike
 * probes 0/18: fixture f1 expected under 数控 but never matched, while its
 * stored searchText starts with the domain-token prefix "cnc 数控").
 *
 * Working hypothesis H3: f1's digest row is genuinely absent from term
 * 数控's posting list (stale/lagging index entry built from an earlier
 * version of the digest text without the cold-search domain prefix).
 *
 * Probe plan (systematic-debugging, refute first):
 *  - A  search(数控, 500)            — Path A fixture hits
 *  - B  full Path-B scan for 数控    — complete posting-list walk (isDone)
 *  - C  searchBySourceKeyForTest(数控, f1.sourceKey) — f1 in posting list?
 *  - D  same for f7.sourceKey (positive control, expect f7)
 *  - E  same for f8.sourceKey (fresh-row control)
 *  - F  positive controls expecting f1: 数控车床 / 陈师傅 / 钳工 (+ scan)
 *  - G  forced rebuild: re-upsert f1's digest, settle, re-run A+B
 *
 * f8 is a minimal control (数控 in skills only) so a fresh row with the
 * same sourceKey discriminates row-specific staleness from corpus-wide
 * behavior. Duplicate digest rows per resumeId are counted to rule out a
 * second (older) digest row shadowing the index entry.
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../packages/convex/convex/_generated/api.js";

const CONVEX_URL = process.env.CONVEX_URL ?? "http://127.0.0.1:3210";
const PREFIX = "fixture.cjk.anomaly.";

const LONG_RUN =
  "本公司主营高精密数控车床加工中心五金零件批量生产制造与工艺优化服务，涵盖模具设计开发、自动化生产线维护调试及数控编程标准化工作全流程";
const CAP_FILLER_SENTENCE =
  "我们工厂专注于不锈钢钣金件激光切割焊接抛光与表面处理工序，严格执行质量管理体系并持续改善现场作业环境与安全规范，同时推进精益生产与看板管理，降低库存周转天数并提升交付准时率与客户满意度。";
const CAP_FILLER = CAP_FILLER_SENTENCE.repeat(22);

interface CjkFixture {
  id: string;
  externalId: string;
  content: Record<string, unknown>;
}

const fixtureDefs: Array<{ id: string; content: Record<string, unknown> }> = [
  // f1: exact spike fixture — 数控 expected under probes 0/18 but missing.
  {
    id: "f1",
    content: {
      name: "陈师傅",
      selfIntro:
        "十年数控车床加工中心操作经验，负责高精密零件批量生产制造，主导工艺优化与设备维护，熟悉机床操作调试与数控编程，参与五金冲压模具设计改进。" +
        LONG_RUN,
      workHistory: [
        {
          companyName: "华东精密机械有限公司",
          jobTitle: "数控车床师傅",
          startDate: "2018-03",
          endDate: "2025-06",
        },
      ],
      skills: ["数控车床", "加工中心", "UG编程", "钳工", LONG_RUN, CAP_FILLER],
      education: "中专",
    },
  },
  // f7: exact spike fixture — matches 数控 on both paths (positive control).
  {
    id: "f7",
    content: {
      name: "孙编程",
      selfIntro:
        "五年CNC编程与CNC操机经验，熟练使用Mastercam与UG编程，操作三轴四轴加工中心，负责批量零件加工与数控机床调试。",
      workHistory: [
        {
          companyName: "锐志机械制造厂",
          jobTitle: "CNC编程技术员",
          startDate: "2020-03",
          endDate: "2025-05",
        },
      ],
      skills: ["CNC编程", "Mastercam", "操机"],
      education: "大专",
    },
  },
  // f8: minimal control — fresh row, 数控 only in skills (domain token).
  {
    id: "f8",
    content: {
      name: "单测",
      selfIntro: "数控机床操作实习。",
      workHistory: [
        {
          companyName: "测试机械厂",
          jobTitle: "数控学徒",
          startDate: "2024-01",
          endDate: "2025-06",
        },
      ],
      skills: ["数控"],
      education: "中专",
    },
  },
];

const fixtures: CjkFixture[] = fixtureDefs.map((fx) => ({
  ...fx,
  externalId: `${PREFIX}${fx.id}`,
}));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function scanPage(convex: ConvexHttpClient, numItems: number) {
  return (await convex.query(api.resumes_search.scanResumeDigestPage, {
    numItems,
  })) as any;
}

/** Full Path-B walk for one query, emulating the BFF's expandSearchQuery. */
async function scanAll(
  convex: ConvexHttpClient,
  query: string,
  fixtureIdToName: Map<string, string>,
  searchTextById: Map<string, string>,
) {
  const bffTokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  const allItems: any[] = [];
  let cursor: string | null = null;
  let pages = 0;
  for (;;) {
    const page = (await convex.query(
      api.resumes_search.searchWithTagExpansionScanPage,
      {
        paginationOpts: { numItems: 16, cursor },
        query,
        keywordGroups: bffTokens.map((t) => ({ original: t, variants: [t] })),
        mode: "AND",
      },
    )) as any;
    const items = Array.isArray(page?.page) ? page.page : [];
    allItems.push(...items);
    pages += 1;
    if (page?.isDone || !page?.continueCursor) break;
    cursor = page.continueCursor;
    if (allItems.length > 2000) {
      return { allItems, pages, guard: true };
    }
  }
  const fixtureHits: string[] = [];
  let overlapFailures = 0;
  for (const item of allItems) {
    const rid = String(item.resume?._id ?? "");
    const name = fixtureIdToName.get(rid);
    if (!name) continue;
    fixtureHits.push(name);
    const st = (searchTextById.get(rid) ?? "").toLowerCase();
    if (!bffTokens.every((t) => st.includes(t))) overlapFailures += 1;
  }
  return { allItems, pages, guard: false, fixtureHits, overlapFailures };
}

function fixtureHitsOf(hits: any[], fixtureIdToName: Map<string, string>): string[] {
  return hits
    .map((h) => (fixtureIdToName.has(String(h._id)) ? fixtureIdToName.get(String(h._id))! : null))
    .filter((x) => x !== null);
}

async function main() {
  const convex = new ConvexHttpClient(CONVEX_URL);
  const results: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    convexUrl: CONVEX_URL,
    fixtures: fixtures.map((fx) => fx.id),
  };

  // 1. Submit fixtures via the shipped ingest path (same args as spike).
  const submit = (await convex.mutation(api.resume_tasks.submitResumes, {
    resumes: fixtures.map((fx) => ({
      externalId: fx.externalId,
      content: fx.content,
      hash: `cjk-anomaly-${fx.id}-hash`,
      source: "manual-fixture",
      tags: ["cjk-spike"],
      restoreState: {
        primaryRuleScore: 50,
        ingestData: {
          market: "cn",
          evidenceText: "cjk anomaly probe fixture",
          industryTags: ["机械"],
          synonymHits: [],
          companyHits: [],
          ruleScores: {},
          experienceLevel: "unknown",
          computedAt: Date.now(),
          skillsVersion: 1,
        },
      },
    })),
  })) as any;
  console.log("submit:", JSON.stringify(submit));

  // 2. Resolve fixture resume ids, upsert digests.
  const allResumes = (await convex.query(api.resumes.list, { limit: 500 })) as any[];
  const byExternalId = new Map(allResumes.map((r) => [r.externalId, r]));
  const fixtureIds: string[] = [];
  for (const fx of fixtures) {
    const doc = byExternalId.get(fx.externalId);
    if (!doc) throw new Error(`fixture ${fx.id} missing after submit`);
    fixtureIds.push(doc._id);
    await convex.mutation(api.resumes_search.upsertResumeDigestForTest, {
      resumeId: doc._id,
    });
  }
  console.log("digests upserted:", fixtureIds.length);

  // 3. Settle so index updates flush (spike runs probes immediately after
  // upserts; we add a settle window to separate index-lag from tokenization).
  await sleep(10_000);

  // 4. Digest dump: full searchText, sourceKey, duplicate-row count.
  const digestPage = await scanPage(convex, 500);
  const digestRows = Array.isArray(digestPage?.docs) ? digestPage.docs : [];
  const searchTextById = new Map<string, string>();
  const sourceKeyById = new Map<string, string>();
  const rowCountById = new Map<string, number>();
  for (const row of digestRows) {
    if (typeof row.resumeId !== "string") continue;
    if (typeof row.searchText === "string") searchTextById.set(row.resumeId, row.searchText);
    if (typeof row.sourceKey === "string") sourceKeyById.set(row.resumeId, row.sourceKey);
    rowCountById.set(row.resumeId, (rowCountById.get(row.resumeId) ?? 0) + 1);
  }
  results.digestRowsScanned = digestRows.length;
  results.digestsPerFixture = Object.fromEntries(
    fixtureIds.map((id) => [id, rowCountById.get(id) ?? 0]),
  );
  results.digestSamples = fixtures.map((fx) => {
    const doc = byExternalId.get(fx.externalId);
    const rid = doc ? String(doc._id) : "";
    const st = searchTextById.get(rid) ?? "";
    return {
      id: fx.id,
      resumeId: rid,
      sourceKey: sourceKeyById.get(rid) ?? null,
      searchTextLength: st.length,
      fullSearchText: st,
    };
  });
  const fixtureIdToName = new Map(fixtureIds.map((id, i) => [id, fixtures[i].id]));
  const nameById = new Map(fixtureIds.map((id, i) => [id, fixtures[i].id]));

  const phase = async (label: string, key: string, fn: () => Promise<unknown>) => {
    try {
      const out = await fn();
      results[key] = { phase: label, ...(out as object) };
      console.log(`${label}:`, JSON.stringify(out));
    } catch (err: any) {
      results[key] = { phase: label, error: err?.message ?? String(err) };
      console.log(`${label}: ERROR`, err?.message ?? err);
    }
  };

  // 5. Phase 1 probes.
  await phase("A", "A_search_500", async () => {
    const hits = (await convex.query(api.resumes_search.search, {
      query: "数控",
      limit: 500,
    })) as any[];
    return { total: hits.length, fixtureHits: fixtureHitsOf(hits, fixtureIdToName) };
  });

  await phase("B", "B_scan_数控_full", async () => {
    const out = await scanAll(convex, "数控", fixtureIdToName, searchTextById);
    return {
      total: out.allItems.length,
      pages: out.pages,
      guard: out.guard,
      fixtureHits: out.fixtureHits,
      overlapFailures: out.overlapFailures,
    };
  });

  await phase("C", "C_srcKey_f1", async () => {
    const sk = sourceKeyById.get(String(byExternalId.get(fixtures[0].externalId)?._id)) ?? "unknown";
    const hits = (await convex.query(api.resumes_search.searchBySourceKeyForTest, {
      query: "数控",
      sourceKey: sk,
      limit: 500,
    })) as any[];
    return { sourceKey: sk, total: hits.length, fixtureHits: fixtureHitsOf(hits, fixtureIdToName) };
  });

  await phase("D", "D_srcKey_f7", async () => {
    const sk = sourceKeyById.get(String(byExternalId.get(fixtures[1].externalId)?._id)) ?? "unknown";
    const hits = (await convex.query(api.resumes_search.searchBySourceKeyForTest, {
      query: "数控",
      sourceKey: sk,
      limit: 500,
    })) as any[];
    return { sourceKey: sk, total: hits.length, fixtureHits: fixtureHitsOf(hits, fixtureIdToName) };
  });

  await phase("E", "E_srcKey_f8", async () => {
    const sk = sourceKeyById.get(String(byExternalId.get(fixtures[2].externalId)?._id)) ?? "unknown";
    const hits = (await convex.query(api.resumes_search.searchBySourceKeyForTest, {
      query: "数控",
      sourceKey: sk,
      limit: 500,
    })) as any[];
    return { sourceKey: sk, total: hits.length, fixtureHits: fixtureHitsOf(hits, fixtureIdToName) };
  });

  for (const [key, q] of [
    ["F1_ctrl_数控车床", "数控车床"],
    ["F2_ctrl_陈师傅", "陈师傅"],
    ["F3_ctrl_钳工", "钳工"],
  ] as const) {
    await phase(key, key, async () => {
      const hits = (await convex.query(api.resumes_search.search, {
        query: q,
        limit: 500,
      })) as any[];
      return { total: hits.length, fixtureHits: fixtureHitsOf(hits, fixtureIdToName) };
    });
  }

  await phase("F4", "F4_ctrl_scan_数控车床", async () => {
    const out = await scanAll(convex, "数控车床", fixtureIdToName, searchTextById);
    return {
      total: out.allItems.length,
      pages: out.pages,
      fixtureHits: out.fixtureHits,
      overlapFailures: out.overlapFailures,
    };
  });

  // 6. Phase 2 (G): forced rebuild of f1's digest, then re-run A+B.
  await phase("G", "G_reupsert", async () => {
    await convex.mutation(api.resumes_search.upsertResumeDigestForTest, {
      resumeId: String(byExternalId.get(fixtures[0].externalId)?._id),
    });
    await sleep(5_000);
    return { reupserted: fixtures[0].id };
  });

  await phase("A2", "A2_search_500_after_rebuild", async () => {
    const hits = (await convex.query(api.resumes_search.search, {
      query: "数控",
      limit: 500,
    })) as any[];
    return { total: hits.length, fixtureHits: fixtureHitsOf(hits, fixtureIdToName) };
  });

  await phase("B2", "B2_scan_数控_full_after_rebuild", async () => {
    const out = await scanAll(convex, "数控", fixtureIdToName, searchTextById);
    return {
      total: out.allItems.length,
      pages: out.pages,
      guard: out.guard,
      fixtureHits: out.fixtureHits,
      overlapFailures: out.overlapFailures,
    };
  });

  // 7. Cleanup.
  try {
    const del = (await convex.mutation(api.resumes_mutations.deleteResumes, {
      resumeIds: fixtureIds,
    })) as any;
    console.log("cleanup delete:", JSON.stringify(del));
  } catch (err: any) {
    console.error("cleanup delete failed:", err?.message ?? err);
    results.cleanupError = err?.message ?? String(err);
  }
  const after = (await convex.query(api.resumes.list, { limit: 500 })) as any[];
  const remaining = after.filter((r) => String(r.externalId ?? "").startsWith(PREFIX)).length;
  results.remainingFixtures = remaining;
  console.log("fixtures remaining after cleanup:", remaining);

  mkdirSync("scripts/output", { recursive: true });
  writeFileSync(
    "scripts/output/cjk-anomaly-results.json",
    JSON.stringify(results, null, 2),
  );
  console.log("results written to scripts/output/cjk-anomaly-results.json");

  if (remaining !== 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("FAILED:", err?.message ?? err);
  process.exitCode = 1;
});
