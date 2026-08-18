/**
 * t6 fixture digest: upsert a resume_digests row for the fixture resume so the
 * BFF listWithIngestData query (which only reads digests) surfaces it.
 * Uses the test-only public mutation upsertResumeDigestForTest.
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../packages/convex/convex/_generated/api.js";

const client = new ConvexHttpClient("http://127.0.0.1:3210");

const FIXTURE_EXTERNAL_ID = "fixture.polywell.override-verify-001";

async function main() {
  const resumes = (await client.query(api.resumes.list, {})) as any[];
  const fixture = resumes.find((r) => r.externalId === FIXTURE_EXTERNAL_ID);
  if (!fixture) {
    console.error("Fixture resume not found");
    process.exit(1);
  }
  console.log("fixture _id:", fixture._id);

  const result = await client.mutation(api.resumes_search.upsertResumeDigestForTest, {
    resumeId: fixture._id,
  });
  console.log("digest upsert result:", JSON.stringify(result));

  // Verify the digest row exists
  const digestPage = (await client.query(api.resumes_search.scanResumeDigestPage, {
    numItems: 1000,
  })) as any;
  const hit = digestPage.docs.find((d: any) => d.resumeId === fixture._id);
  console.log("digest row:", hit ? JSON.stringify({ resumeId: hit.resumeId, source: hit.source, primaryRuleScore: hit.primaryRuleScore }) : "NOT FOUND");
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});
