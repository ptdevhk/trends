/**
 * t3 durable-match-snapshot verification: submit a fixture resume with a
 * polywell work-history surface, run the company-link backfill, verify
 * content.workHistory entries carry durable companyKey (+ companyKeyRevision)
 * stamps, verify the link row, then clean up (including the delete cascade).
 */
import "dotenv/config";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../packages/convex/convex/_generated/api.js";

const FIXTURE_EXTERNAL_ID = "fixture.polywell.stamp-verify-001";

async function main() {
  const convex = new ConvexHttpClient("http://127.0.0.1:3210");
  const writeSecret = process.env.CONVEX_WRITE_SECRET!;

  // 1. Submit fixture resume (polywell + pro-technic surfaces).
  const submit = (await convex.mutation(api.resume_tasks.submitResumes, {
    resumes: [
      {
        externalId: FIXTURE_EXTERNAL_ID,
        content: {
          name: "T3 Stamp Fixture User",
          selfIntro: "Fixture resume for durable match snapshot verification.",
          workHistory: [
            {
              companyName: "Polywell",
              jobTitle: "CNC技师",
              startDate: "2021-01",
              endDate: "2023-06",
            },
            {
              companyName: "宝力机械",
              jobTitle: "销售经理",
              startDate: "2019-03",
              endDate: "2020-12",
            },
          ],
        },
        hash: "t3-fixture-hash-001",
        source: "manual-fixture",
        tags: [],
        restoreState: {
          primaryRuleScore: 99,
          ingestData: {
            market: "cn",
            evidenceText: "t3 fixture",
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

  const resumes = (await convex.query(api.resumes.list, { limit: 500 })) as any[];
  const fixture = resumes.find((r) => r.externalId === FIXTURE_EXTERNAL_ID);
  if (!fixture) throw new Error("fixture resume not found after submit");
  console.log("fixture _id:", fixture._id);
  console.log("workHistory before backfill:", JSON.stringify(fixture.content.workHistory));

  // 2. Digest (BFF list surface).
  await convex.mutation(api.resumes_search.upsertResumeDigestForTest, {
    resumeId: fixture._id,
  });
  console.log("digest upserted");

  // 3. Backfill for polywell (sync action, write-secret gated).
  const backfill = (await convex.action(
    api.companies.backfillCompanyResumeLinksByCompanySync,
    { writeSecret, companyKey: "polywell" },
  )) as any;
  console.log("backfill:", JSON.stringify(backfill));

  // 4. Verify stamps on the fixture resume.
  const after = (await convex.query(api.resumes.list, { limit: 500 })) as any[];
  const stamped = after.find((r) => r.externalId === FIXTURE_EXTERNAL_ID);
  if (!stamped) throw new Error("fixture resume missing after backfill");
  console.log("workHistory after backfill:", JSON.stringify(stamped.content.workHistory));

  const first = stamped.content.workHistory?.[0] ?? {};
  const second = stamped.content.workHistory?.[1] ?? {};
  const ok1 = first.companyKey === "polywell";
  console.log(
    "entry[0] companyKey=polywell:",
    ok1,
    "| companyKeyRevision:",
    first.companyKeyRevision ?? "(none)",
  );
  const ok2 = !second.companyKey;
  console.log("entry[1] untouched (no cross-company clobber):", ok2);

  // 5. Link row exists for the fixture. Fixture resumes are submitted
  // without a workspaceSlug, so their link rows land under the default
  // workspace ("dev") rather than "hr" — check both, paginating fully (the
  // fixture row sorts last by _id and can fall beyond the first page).
  const findLinkRow = async (resumeId: string) => {
    for (const workspaceSlug of ["hr", "dev"]) {
      let cursor: string | null = null;
      for (;;) {
        const page = (await convex.query(
          api.company_resume_links.listAffectedResumesByCompany,
          {
            writeSecret,
            workspaceSlug,
            companyKey: "polywell",
            limit: 200,
            ...(cursor ? { cursor } : {}),
          },
        )) as any;
        if ((page.items ?? []).some((row: any) => String(row.resumeId) === resumeId)) {
          return { present: true, workspaceSlug };
        }
        if (page.isDone || !page.continueCursor) break;
        cursor = page.continueCursor;
      }
    }
    return { present: false, workspaceSlug: null };
  };

  const linked = await findLinkRow(fixture._id);
  console.log(
    "fixture in affected links (full pagination, hr+dev):",
    linked.present,
    linked.workspaceSlug ? `(workspace ${linked.workspaceSlug})` : "",
  );

  // 6. Cleanup: deleteResumes must cascade the link row too.
  const del = (await convex.mutation(api.resumes_mutations.deleteResumes, {
    resumeIds: [fixture._id],
  })) as any;
  console.log("delete:", JSON.stringify(del));

  const stillLinked = await findLinkRow(fixture._id);
  console.log("fixture link row removed by delete cascade:", !stillLinked.present);

  const remaining = (await convex.query(api.resumes.list, { limit: 500 })) as any[];
  console.log(
    "fixture resumes remaining:",
    remaining.filter((r) => r.externalId === FIXTURE_EXTERNAL_ID).length,
  );

  if (!(ok1 && ok2 && linked.present && !stillLinked.present)) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});
