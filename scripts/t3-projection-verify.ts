/**
 * T3 durable match-snapshot verification: submit a fixture resume with a
 * polywell work-history surface, run the company-link backfill (stamps
 * companyKey onto DB content), then drive the company-key projection drain
 * (dry-run → cursor-chained real drain → settle dry-run) and verify the
 * resume doc carries the durable companyKeyProjection snapshot (epoch +
 * keys + tokens). Cleans up the fixture afterwards.
 *
 * Notes:
 * - The drain is single-page per call (cursor-chained by the caller); the
 *   whole local DB is stale for a new epoch, so this walks every page until
 *   hasMore=false.
 * - Scheduled patches run asynchronously: after each page we poll the
 *   fixture (bounded), and the settle phase re-walks full dry-runs until
 *   the total stale count reaches 0.
 */
import "dotenv/config";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../packages/convex/convex/_generated/api.js";

const FIXTURE_EXTERNAL_ID = "fixture.polywell.projection-verify-001";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const convex = new ConvexHttpClient("http://127.0.0.1:3210");
  const writeSecret = process.env.CONVEX_WRITE_SECRET!;

  // 1. Submit fixture resume (polywell + pro-technic surfaces).
  const submit = (await convex.mutation(api.resume_tasks.submitResumes, {
    resumes: [
      {
        externalId: FIXTURE_EXTERNAL_ID,
        content: {
          name: "T3 Projection Fixture User",
          selfIntro: "Fixture resume for durable company-key projection verification.",
          workHistory: [
            {
              companyName: "Polywell",
              jobTitle: "CNC技师",
              startDate: "2021-01",
              endDate: "2023-06",
            },
          ],
        },
        hash: "t3-fixture-hash-proj-001",
        source: "manual-fixture",
        tags: [],
        restoreState: {
          primaryRuleScore: 99,
          ingestData: {
            market: "cn",
            evidenceText: "t3 projection fixture",
            industryTags: ["机械"],
            synonymHits: [],
            companyHits: ["polywell"],
            ruleScores: {},
            experienceLevel: "unknown",
            computedAt: Date.now(),
            skillsVersion: 1,
          },
        },
      },
    ],
  })) as any;
  console.log("submit:", JSON.stringify(submit));

  const findFixture = async () => {
    const resumes = (await convex.query(api.resumes.list, { limit: 200 })) as any[];
    return resumes.find((r) => r.externalId === FIXTURE_EXTERNAL_ID) ?? null;
  };
  const before = await findFixture();
  if (!before) throw new Error("fixture resume not found after submit");
  const fixtureId = before._id as string;
  console.log("fixture _id:", fixtureId);
  console.log(
    "projection before drain:",
    JSON.stringify(before.companyKeyProjection ?? null),
  );

  // 2. Backfill for polywell (sync action, write-secret gated) so the DB
  // content.workHistory entry carries the durable companyKey stamp.
  const backfill = (await convex.action(
    api.companies.backfillCompanyResumeLinksByCompanySync,
    { writeSecret, companyKey: "polywell" },
  )) as any;
  console.log("backfill:", JSON.stringify(backfill));

  // 3. Initial dry-run (first page only): fixture is in the newest rows, so
  // a non-zero staleCount proves the new epoch marks it stale.
  const dry1 = (await convex.action(api.migrations.recomputeCompanyKeyProjections, {
    limit: 1000,
    dryRun: true,
  })) as any;
  console.log("dry-run #1:", JSON.stringify(dry1));

  // 4. Cursor-chained real drain to completion; poll the fixture after each
  // page until its snapshot lands (scheduled patches run asynchronously).
  let cursor: string | null = null;
  let hasMore = true;
  let fixtureStamped = false;
  let guard = 0;
  while (hasMore && guard < 300) {
    guard++;
    const real = (await convex.action(api.migrations.recomputeCompanyKeyProjections, {
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    })) as any;
    console.log(
      `drain iter ${guard}: scheduled=${real.scheduled} batches=${real.batches} ` +
        `scannedRows=${real.scannedRows} staleCount=${real.staleCount} hasMore=${real.hasMore}`,
    );
    cursor = typeof real.cursor === "string" && real.cursor.length > 0 ? real.cursor : null;
    hasMore = real.hasMore === true;
    if (!fixtureStamped) {
      for (let poll = 0; poll < 12; poll++) {
        await sleep(500);
        const row = await findFixture();
        if (row?.companyKeyProjection?.epoch != null) {
          fixtureStamped = true;
          console.log(`fixture stamped after drain iter ${guard}, poll ${poll}`);
          break;
        }
      }
    }
  }
  if (!fixtureStamped) throw new Error("fixture projection not stamped after drain loop");

  // 5. Settle: full dry-run cursor walks until total stale count is 0.
  const fullDryRun = async () => {
    let walkCursor: string | null = null;
    let totalStale = 0;
    let totalScanned = 0;
    let done = false;
    let walkGuard = 0;
    while (!done && walkGuard < 300) {
      walkGuard++;
      const page = (await convex.action(api.migrations.recomputeCompanyKeyProjections, {
        limit: 1000,
        dryRun: true,
        ...(walkCursor ? { cursor: walkCursor } : {}),
      })) as any;
      totalStale += page.staleCount ?? 0;
      totalScanned += page.scannedRows ?? 0;
      walkCursor = typeof page.cursor === "string" && page.cursor.length > 0 ? page.cursor : null;
      done = page.hasMore !== true;
    }
    return { totalStale, totalScanned, done };
  };

  let dry2: { totalStale: number; totalScanned: number } | null = null;
  for (let attempt = 1; attempt <= 8; attempt++) {
    dry2 = await fullDryRun();
    console.log(
      `settle dry-run attempt ${attempt}: scanned=${dry2.totalScanned} stale=${dry2.totalStale}`,
    );
    if (dry2.totalStale === 0) break;
    await sleep(3000);
  }

  // 6. Verify the fixture doc's snapshot.
  const after = await findFixture();
  if (!after) throw new Error("fixture resume missing after drain");
  const projection = after.companyKeyProjection as any;
  console.log("projection after drain:", JSON.stringify(projection));

  const okEpoch = typeof projection?.epoch === "number" && projection.epoch >= 1;
  const okKeys = Array.isArray(projection?.companyKeys)
    && projection.companyKeys.includes("polywell");
  const okTokens = Array.isArray(projection?.companyTokens)
    && projection.companyTokens.some((token: string) => String(token).toLowerCase().includes("polywell"));
  const okStaleZero = dry2?.totalStale === 0 && dry2.done === true;
  console.log("epoch stamped:", okEpoch, "| companyKeys has polywell:", okKeys);
  console.log("companyTokens include polywell token:", okTokens);
  console.log("full dry-run stale=0:", okStaleZero);

  // 7. Cleanup: deleteResumes must remove the fixture (cascade).
  const del = (await convex.mutation(api.resumes_mutations.deleteResumes, {
    resumeIds: [fixtureId],
  })) as any;
  console.log("delete:", JSON.stringify(del));
  const remaining = await findFixture();
  console.log("fixture resumes remaining:", remaining ? 1 : 0);

  if (!(okEpoch && okKeys && okTokens && okStaleZero && !remaining)) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});
