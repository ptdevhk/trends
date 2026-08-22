/**
 * cjk-segmentation measurement spike (#7): measure CJK search recall of the
 * shipped Convex search paths against a controlled fixture corpus.
 *
 * Design (see docs/runbooks/cjk-segmentation-measurement.md):
 *  - 7 fixture resumes with distinct CN profiles, ingested via the shipped
 *    resume_tasks.submitResumes + resumes_search.upsertResumeDigestForTest.
 *  - ~39 queries in 9 classes (single-term, compound, CJK+ASCII mix,
 *    multi-term whitespace, long compounds, alias tokens, cap probes,
 *    single-char, noise).
 *  - Ground truth = fixtures whose RAW content (JSON, lowercased) contains
 *    every whitespace-split query token.
 *  - Two shipped paths probed per query:
 *      A. resumes_search.search           — plain index path (web quick search)
 *      B. searchWithTagExpansionScanPage  — BFF tag-expansion scan path,
 *         keywordGroups emulated exactly like the BFF's expandSearchQuery
 *         (per-token groups, variants=[token], AND mode, <2-char tokens
 *         dropped).
 *  - Cap probes: single-term length cap (20/32/40/64-char tokens taken from a
 *    real run inside fixture f1) and the 16-term AND cap (17th token must be
 *    dropped for the query to match).
 *  - Cleanup: deleteResumes on all fixture ids (cascades digests).
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../packages/convex/convex/_generated/api.js";
import { normalizeSearchQuery } from "../packages/shared/src/search-text.js";

const CONVEX_URL = process.env.CONVEX_URL ?? "http://127.0.0.1:3210";
const PREFIX = "fixture.cjk.";

// The long run used for length-cap probes; MUST also appear in f1 content.
const LONG_RUN =
  "本公司主营高精密数控车床加工中心五金零件批量生产制造与工艺优化服务，涵盖模具设计开发、自动化生产线维护调试及数控编程标准化工作全流程";

if (LONG_RUN.length < 64) {
  throw new Error(`LONG_RUN too short for cap probes: ${LONG_RUN.length} chars`);
}

// Neutral CN filler that overflows the digest searchText cap
// (MAX_DIGEST_SEARCH_TEXT_LENGTH = 1500). Contains no queryCorpus probe
// tokens, so it only changes f1's digest length, not any ground truth.
const CAP_FILLER_SENTENCE =
  "我们工厂专注于不锈钢钣金件激光切割焊接抛光与表面处理工序，严格执行质量管理体系并持续改善现场作业环境与安全规范，同时推进精益生产与看板管理，降低库存周转天数并提升交付准时率与客户满意度。";
// repeat(22): f1's digest is ~111 chars + LONG_RUN (~66+segments); 22×66=1452
// pushes the total past the 1500 cap so the cap probes measure real behavior.
const CAP_FILLER = CAP_FILLER_SENTENCE.repeat(22);

interface CjkFixture {
  id: string;
  externalId: string;
  content: Record<string, unknown>;
  rawLower: string;
}

const fixtureDefs: Array<{ id: string; content: Record<string, unknown> }> = [
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
  {
    id: "f2",
    content: {
      name: "王主管",
      selfIntro:
        "八年品质管理经验，主导ISO9001质量管理体系推行与客诉处理，擅长供应商质量审核与品质改善专案，熟悉品质检验标准与SOP制定。",
      workHistory: [
        {
          companyName: "联创电子科技",
          jobTitle: "品质主管",
          startDate: "2019-02",
          endDate: "2025-05",
        },
      ],
      skills: ["品质管理", "ISO9001", "客诉处理"],
      education: "大专",
    },
  },
  {
    id: "f3",
    content: {
      name: "李运营",
      selfIntro:
        "三年跨境电商运营经验，负责亚马逊与速卖通店铺日常运营，精通选品、广告投放与站外推广，擅长数据分析与Listing优化。",
      workHistory: [
        {
          companyName: "星链跨境电子商务有限公司",
          jobTitle: "跨境电商运营",
          startDate: "2021-04",
          endDate: "2025-07",
        },
      ],
      skills: ["亚马逊运营", "速卖通", "数据分析"],
      education: "本科",
    },
  },
  {
    id: "f4",
    content: {
      name: "张技工",
      selfIntro:
        "十二年平面磨床、无心磨床与内圆磨床操作经验，精密研磨加工与尺寸公差控制，熟悉精密量具使用与机床保养。",
      workHistory: [
        {
          companyName: "顺达精密五金厂",
          jobTitle: "平面磨床技工",
          startDate: "2013-06",
          endDate: "2025-04",
        },
      ],
      skills: ["平面磨床", "无心磨床", "内圆磨床"],
      education: "高中",
    },
  },
  {
    id: "f5",
    content: {
      name: "赵设计",
      selfIntro:
        "五金冲压模具设计开发经验，熟练使用CAD与UG进行模具绘图，负责冲压工艺分析与试模改善，设计连续模与工程模。",
      workHistory: [
        {
          companyName: "精工模具有限公司",
          jobTitle: "模具设计师",
          startDate: "2017-09",
          endDate: "2025-03",
        },
      ],
      skills: ["五金冲压", "模具设计", "CAD", "UG"],
      education: "大专",
    },
  },
  {
    id: "f6",
    content: {
      name: "刘电工",
      selfIntro:
        "持电工证与焊工证，氩弧焊与电焊熟练，擅长电路维修与设备安装调试，负责工厂电气设备日常维护。",
      workHistory: [
        {
          companyName: "宏远机电设备公司",
          jobTitle: "电工",
          startDate: "2015-01",
          endDate: "2025-06",
        },
      ],
      skills: ["电工证", "焊工证", "氩弧焊", "电路维修"],
      education: "中专",
    },
  },
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
];

const fixtures: CjkFixture[] = fixtureDefs.map((def) => ({
  id: def.id,
  externalId: `${PREFIX}${def.id}`,
  content: def.content,
  rawLower: JSON.stringify(def.content).toLowerCase(),
}));

// 17th token matches nothing: with the 16-term cap active the query matches f1
// (tokens 1-16 all in f1); without the cap no document can match all 17.
const CAP17_TERMS =
  "数控 车床 加工 中心 零件 生产 制造 工艺 优化 维护 操作 调试 编程 机床 模具 设计 zzzzz";

interface QueryProbe {
  q: string;
  cls: string;
}

const queryCorpus: QueryProbe[] = [
  // class 1: single-term CJK
  { q: "数控", cls: "single" },
  { q: "磨床", cls: "single" },
  { q: "模具", cls: "single" },
  { q: "焊工", cls: "single" },
  { q: "电工", cls: "single" },
  { q: "跨境电商", cls: "single" },
  // class 2: compound (unsegmented CJK run)
  { q: "数控车床", cls: "compound" },
  { q: "平面磨床", cls: "compound" },
  { q: "冲压模具", cls: "compound" },
  { q: "品质主管", cls: "compound" },
  { q: "跨境电商运营", cls: "compound" },
  { q: "模具设计", cls: "compound" },
  { q: "数控车床师傅", cls: "compound" },
  // class 3: CJK+ASCII mix
  { q: "CNC编程", cls: "cjk-ascii" },
  { q: "CNC操机", cls: "cjk-ascii" },
  { q: "ISO9001", cls: "cjk-ascii" },
  { q: "Mastercam", cls: "cjk-ascii" },
  { q: "UG编程", cls: "cjk-ascii" },
  // class 4: multi-term whitespace
  { q: "数控 车床", cls: "multi" },
  { q: "模具 设计", cls: "multi" },
  { q: "磨床 技工", cls: "multi" },
  { q: "品质 主管", cls: "multi" },
  { q: "跨境电商 运营", cls: "multi" },
  { q: "CNC 操机", cls: "multi" },
  // class 5: long compounds (8-15 chars)
  { q: "五金冲压模具设计", cls: "long-compound" },
  { q: "跨境电商运营经验", cls: "long-compound" },
  { q: "平面磨床技工", cls: "long-compound" },
  // class 6: alias tokens (cnc<->数控, 机床->machine tools, 销售->sales)
  { q: "cnc", cls: "alias" },
  { q: "机床", cls: "alias" },
  { q: "machine tools", cls: "alias" },
  { q: "sales", cls: "alias" },
  // class 7: cap probes
  { q: LONG_RUN.slice(0, 20), cls: "cap-length" },
  { q: LONG_RUN.slice(0, 32), cls: "cap-length" },
  { q: LONG_RUN.slice(0, 40), cls: "cap-length" },
  { q: LONG_RUN.slice(0, 64), cls: "cap-length" },
  { q: LONG_RUN, cls: "cap-length" },
  { q: CAP17_TERMS, cls: "cap-terms" },
  // class 8: single-char CJK
  { q: "车", cls: "single-char" },
  { q: "模", cls: "single-char" },
  // class 9: noise (no expected fixtures)
  { q: "汽车维修", cls: "noise" },
];

// Ground truth: every whitespace-split query token must appear in the RAW
// fixture content (JSON, lowercased) — the un-segmented, un-aliased text.
function expectedFixtureIds(query: string): string[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 1);
  return fixtures
    .filter((fx) => tokens.every((t) => fx.rawLower.includes(t)))
    .map((fx) => fx.id);
}

async function main() {
  const convex = new ConvexHttpClient(CONVEX_URL);
  const results: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    convexUrl: CONVEX_URL,
    longRunLength: LONG_RUN.length,
    fixtures: fixtures.map((fx) => fx.id),
    probes: [],
  };

  // 1. Submit fixtures via the shipped ingest path.
  const submit = (await convex.mutation(api.resume_tasks.submitResumes, {
    resumes: fixtures.map((fx) => ({
      externalId: fx.externalId,
      content: fx.content,
      hash: `cjk-spike-${fx.id}-hash`,
      source: "manual-fixture",
      tags: ["cjk-spike"],
      restoreState: {
        primaryRuleScore: 50,
        ingestData: {
          market: "cn",
          evidenceText: "cjk measurement spike fixture",
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

  // 3. Dump fixture digest searchText (first 300 chars) for the report.
  const digestPage = (await convex.query(api.resumes_search.scanResumeDigestPage, {
    numItems: 500,
  })) as any;
  const digestRows = Array.isArray(digestPage?.docs) ? digestPage.docs : [];
  const searchTextById = new Map<string, string>();
  for (const row of digestRows) {
    if (typeof row.resumeId === "string" && typeof row.searchText === "string") {
      searchTextById.set(String(row.resumeId), row.searchText);
    }
  }
  results.digestSamples = fixtures.map((fx) => {
    const doc = byExternalId.get(fx.externalId);
    const st = doc ? searchTextById.get(String(doc._id)) ?? "" : "";
    return { id: fx.id, searchTextLength: st.length, sample: st.slice(0, 300) };
  });

  // 4. Per-query probes on both shipped paths.
  const expectedByQuery = new Map<string, string[]>();
  const fixtureIdToName = new Map(fixtureIds.map((id, i) => [id, fixtures[i].id]));

  for (const probe of queryCorpus) {
    const expected = expectedFixtureIds(probe.q);
    expectedByQuery.set(probe.q, expected);

    const entry: Record<string, unknown> = {
      cls: probe.cls,
      query: probe.q,
      queryLength: probe.q.length,
      expected: expected,
    };

    // Path A: plain index search. Run at the shipped UI default (50) and at
    // 500 to separate BM25 rank-cutoff effects from tokenization behavior.
    try {
      const hits50 = (await convex.query(api.resumes_search.search, {
        query: probe.q,
        limit: 50,
      })) as any[];
      const hits500 = (await convex.query(api.resumes_search.search, {
        query: probe.q,
        limit: 500,
      })) as any[];
      const fixtureHitsOf = (hits: any[]) =>
        hits
          .map((h) => (fixtureIdToName.has(String(h._id)) ? fixtureIdToName.get(String(h._id))! : null))
          .filter((x) => x !== null);
      const fh50 = fixtureHitsOf(hits50);
      const fh500 = fixtureHitsOf(hits500);
      entry.searchTotalHits50 = hits50.length;
      entry.searchFixtureHits50 = fh50;
      entry.searchTotalHits500 = hits500.length;
      entry.searchFixtureHits500 = fh500;
      entry.searchRecall = expected.length
        ? fh500.filter((id) => expected.includes(id)).length / expected.length
        : null;
    } catch (err: any) {
      entry.searchError = err?.message ?? String(err);
    }

    // Path B: tag-expansion scan page, emulating the BFF's expandSearchQuery
    // group shape: normalizeSearchQuery (boundary-space CJK-ASCII joins),
    // punctuation/newline/comma segment split, per-whitespace-token groups,
    // variants=[token], AND mode, <2-char tokens dropped by the BFF.
    const bffTokens = normalizeSearchQuery(probe.q)
      .split(/[\n\r,，、;；。.．]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .flatMap((s) => s.split(/\s+/))
      .filter((t) => t.length >= 2);
    if (bffTokens.length === 0) {
      entry.scanStatus = "bff-dropped";
    } else {
      try {
        const keywordGroups = bffTokens.map((t) => ({ original: t, variants: [t] }));
        // Paginate all pages with the cursor (the BFF loops until isDone; the
        // unfiltered scan-page caps at 16 rows per page by design).
        const allItems: any[] = [];
        let cursor: string | null = null;
        for (;;) {
          const page = (await convex.query(
            api.resumes_search.searchWithTagExpansionScanPage,
            {
              paginationOpts: { numItems: 16, cursor },
              query: probe.q,
              keywordGroups,
              mode: "AND",
            },
          )) as any;
          const items = Array.isArray(page?.page) ? page.page : [];
          allItems.push(...items);
          if (page?.isDone || !page?.continueCursor) break;
          cursor = page.continueCursor;
          if (allItems.length > 2000) {
            entry.scanPaginationGuard = true;
            break;
          }
        }
        const fixtureHits: string[] = [];
        let tokenOverlapFailures = 0;
        for (const item of allItems) {
          // scan page items are {resume: ResumeListProjectedDoc, provenance},
          // so searchText is not on the item — read it from the digest dump.
          const rid = String(item.resume?._id ?? "");
          const name = fixtureIdToName.get(rid);
          if (!name) continue;
          fixtureHits.push(name);
          const st = (searchTextById.get(rid) ?? "").toLowerCase();
          if (!bffTokens.every((t) => st.includes(t))) tokenOverlapFailures += 1;
        }
        entry.scanTotalHits = allItems.length;
        entry.scanPages = Math.max(1, Math.ceil(allItems.length / 16));
        entry.scanFixtureHits = fixtureHits;
        entry.scanTokenOverlapFailures = tokenOverlapFailures;
        entry.scanRecall = expected.length
          ? fixtureHits.filter((id) => expected.includes(id)).length / expected.length
          : null;
      } catch (err: any) {
        entry.scanError = err?.message ?? String(err);
      }
    }

    results.probes.push(entry);
    console.log(
      JSON.stringify({
        cls: entry.cls,
        q: entry.query.slice(0, 40),
        expected: entry.expected.join(",") || "-",
        search50: entry.searchFixtureHits50?.join(",") ?? entry.searchError ?? "ERR",
        search500: entry.searchFixtureHits500?.join(",") ?? "-",
        scan: entry.scanFixtureHits?.join(",") ?? entry.scanStatus ?? entry.scanError ?? "ERR",
      }),
    );
  }

  // 5. Class-level aggregation.
  const classSummary: Record<string, { probes: number; recallA: number[]; recallB: number[]; errors: number }> = {};
  for (const probe of results.probes as any[]) {
    const cls = classSummary[probe.cls] ?? { probes: 0, recallA: [], recallB: [], errors: 0 };
    cls.probes += 1;
    if (probe.searchRecall !== null && probe.searchRecall !== undefined) cls.recallA.push(probe.searchRecall);
    if (probe.scanRecall !== null && probe.scanRecall !== undefined) cls.recallB.push(probe.scanRecall);
    if (probe.searchError || probe.scanError) cls.errors += 1;
    classSummary[probe.cls] = cls;
  }
  results.classSummary = Object.fromEntries(
    Object.entries(classSummary).map(([cls, s]) => [
      cls,
      {
        probes: s.probes,
        searchMeanRecall: s.recallA.length ? s.recallA.reduce((a, b) => a + b, 0) / s.recallA.length : null,
        scanMeanRecall: s.recallB.length ? s.recallB.reduce((a, b) => a + b, 0) / s.recallB.length : null,
        errors: s.errors,
      },
    ]),
  );

  // 6. Cleanup: delete fixtures (cascades digest rows).
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

  // 7. Persist raw JSON.
  mkdirSync("scripts/output", { recursive: true });
  writeFileSync("scripts/output/cjk-measurement-results.json", JSON.stringify(results, null, 2));
  console.log("results written to scripts/output/cjk-measurement-results.json");

  if (remaining !== 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("FAILED:", err?.message ?? err);
  process.exit(1);
});

