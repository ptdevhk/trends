import { ConvexHttpClient } from "convex/browser";
import { api } from "../packages/convex/convex/_generated/api.js";

const client = new ConvexHttpClient("http://127.0.0.1:3210");

async function main() {
  // 1. All resumes — see workspaceSlug + ingestData shape
  const resumes = (await client.query(api.resumes.list, {})) as any[];
  console.log("=== RESUMES ===", resumes.length);
  for (const r of resumes) {
    console.log(JSON.stringify({
      id: r._id,
      externalId: r.externalId,
      workspaceSlug: r.workspaceSlug,
      source: r.source,
      sourceKey: r.sourceKey,
      tags: r.tags,
      ingestData: r.ingestData ? {
        companyHits: r.ingestData.companyHits,
        industryTags: r.ingestData.industryTags,
        computedAt: r.ingestData.computedAt,
      } : null,
      workHistory: r.content?.workHistory?.map((w: any) => w.companyName ?? w.company) ?? null,
      name: r.content?.name ?? r.content?.basicInfo?.name ?? null,
    }, null, 1));
  }

  // 2. Companies — polywell / pro-technic keys + aliases
  const companies = (await client.query(api.company_registry.list, {})) as any[];
  console.log("\n=== COMPANIES ===");
  for (const c of companies) {
    if (/polywell|pro.?technic/i.test(JSON.stringify(c))) {
      console.log(JSON.stringify({ companyKey: c.companyKey, displayName: c.displayName, aliases: c.aliases, status: c.status }, null, 1));
    }
  }

  // 3. Policy revisions for hr workspace
  const revisions = (await client.query(api.company_registry.listPolicyRevisions, { workspaceSlug: "hr" })) as any[];
  console.log("\n=== POLICY REVISIONS (hr) ===", Array.isArray(revisions) ? revisions.length : typeof revisions);
  if (Array.isArray(revisions)) {
    for (const rev of revisions) {
      console.log(JSON.stringify({ companyKey: rev.companyKey, policy: rev.policy, revisionId: rev.revisionId, status: rev.status, decidedAt: rev.decidedAt }, null, 1));
    }
  }
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});
